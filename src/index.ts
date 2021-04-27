import * as Argv from "cafe-args";
import "reflect-metadata";
import {
  Aggregation,
  findFirstAggregration,
  getAggregation,
} from "./aggregation";
import { Argument, getArgument, IArgument } from "./argument";
import {
  Command,
  GroupCommand,
  InitedCommand,
  isGroupCommand,
  LeafCommand,
} from "./command";
import {
  ExternalOption,
  getExternalOption,
  getOption,
  IOption,
  Option,
} from "./option";
import { createDefaultPrinter, Printer } from "./printer";
import { getCommandInstance } from "./utils";

interface ICli {
  /**
   * Array of the **Root** Command Classes
   */
  rootCommandClasses: { new (): Command }[];
  /**
   * Array of the **Root** options of the CLI
   */
  optionParameters?: IOption[];
  /**
   * test arguments in order to testing the CLI's behaviour
   */
  testArguments?: Array<string>;
  /**
   * Functions used to print messages to the CLI
   */
  printer?: Printer;
}

interface CommandDecoratorData {
  commandOptions: IOption[];
  commandArguments: IArgument[];
}

interface CommandDecoratorDataWithAggregations extends CommandDecoratorData {
  commandAggregationRelations: string[][];
}

/**
 * Fetches the given instance Argument, Option and Aggregation configs
 *
 * @param target Command instance
 * @returns all decorated metadata of the Command instance
 */
function getCommandDecoratorData<T extends Command>(
  target: T
): CommandDecoratorDataWithAggregations {
  const commandOptions: IOption[] = [];
  const commandArguments: IArgument[] = [];
  const commandAggregationRelations: string[][] = [];
  // eslint-disable-next-line guard-for-in
  for (const instanceKey in target) {
    const option = getOption(target, instanceKey);

    if (option) {
      commandOptions.push(option);
      continue;
    }

    const argument = getArgument(target, instanceKey);

    if (argument) {
      commandArguments.push(argument);
      continue;
    }

    const aggregation = getAggregation(target, instanceKey);

    if (aggregation) {
      commandAggregationRelations.push(aggregation);
    }
  }

  return {
    commandOptions,
    commandArguments,
    commandAggregationRelations,
  };
}

/**
 * Recursive regard of aggregated relation of the starting command
 * resolves aggregated relations
 *
 * @return
 */
function getCommandDecoratorFields<T extends Command>(
  target: T,
  initedCommands: InitedCommand[],
  allDecoratorData: CommandDecoratorData
) {
  const commandDecoratorData = getCommandDecoratorData(target);
  // add fetched decorator data to the total
  allDecoratorData.commandArguments.push(
    ...commandDecoratorData.commandArguments
  );
  allDecoratorData.commandOptions.push(...commandDecoratorData.commandOptions);
}

/**
 * Assigns the required CLI argument and option values to the given Command instance
 *
 * @param target Command instance
 * @param options CLI arguments which was mapped to this map object by yargs
 */
function initCommandFields<T extends Command>(
  target: T,
  options: { [key: string]: unknown }
) {
  // eslint-disable-next-line guard-for-in
  for (const key in target) {
    const option = getOption(target, key);

    if (option) {
      const value = options[option.key];

      if (value === undefined) {
        continue;
      }
      target[key] = value as T[Extract<keyof T, string>];
      continue;
    }

    const externalOptionKey = getExternalOption(target, key);

    if (externalOptionKey) {
      const value = options[externalOptionKey];

      if (value === undefined) {
        continue;
      }
      target[key] = value as T[Extract<keyof T, string>];
      continue;
    }
    const argument = getArgument(target, key);

    if (argument) {
      const value = options[argument.key];

      if (value === undefined) {
        continue;
      }
      target[key] = value as T[Extract<keyof T, string>];
      continue;
    }
  }
}

class CommandBuilder {
  /**
   * Used for tests as well
   */
  public initedCommands: InitedCommand[];
  public runnable?: LeafCommand;
  public parser: Argv.Parser;

  public constructor(
    parser: Argv.Parser,
    argv: string[],
    commandClasses: { new (): Command }[]
  ) {
    this.parser = parser;
    this.initedCommands = [];

    this.initCommandClasses(argv, commandClasses);
  }

  private initCommandClasses(argv: string[], commands: { new (): Command }[]) {
    for (const CommandClass of commands) {
      this.initedCommands.push(this.initCommandClass(CommandClass));
    }

    for (const initedCommand of this.initedCommands) {
      this.initCommandInstance(this.parser, initedCommand);
    }

    const context = this.parser.parse(argv);

    if (
      context.exitReason ||
      typeof context === "string" ||
      !context.command?.meta?.instance
    ) {
      return;
    }

    const command = context.command.meta.instance as Command;

    initCommandFields(command, { ...context.options, ...context.arguments });

    if (context.sibling) {
      const key: string = context.command.meta.instance
        .siblingProperty as string;
      const siblingCommand: Command = context.sibling.command.meta
        .instance as Command;
      Reflect.set(command, key, siblingCommand);
      initCommandFields(context.sibling.command.meta.instance as Command, {
        ...context.sibling.options,
        ...context.sibling.arguments,
      });
    }
    this.runnable = context.command.meta.instance as LeafCommand;
  }

  private createGroup(command: GroupCommand): Argv.Group {
    const group = new Argv.Group(command.name, command.description);
    for (const SubcommandClass of command.subCommandClasses) {
      const commandArguments: IArgument[] = [];
      const commandOptions: IOption[] = [];
      const initedSubcommand = new SubcommandClass();
      getCommandDecoratorFields(command, this.initedCommands, {
        commandArguments,
        commandOptions,
      });
      getCommandDecoratorFields(initedSubcommand, this.initedCommands, {
        commandArguments,
        commandOptions,
      });
      const parsableCommand = this.createCommand(
        initedSubcommand,
        commandOptions,
        commandArguments
      );
      group.withCommand(parsableCommand);
    }

    return group;
  }

  private initCommandInstance(
    parser: Argv.Parser,
    initedCommand: InitedCommand
  ): any {
    const commandInstance = initedCommand.command;

    if (isGroupCommand(commandInstance)) {
      const group = this.createGroup(commandInstance);
      parser.addGroup(group);
    } else {
      const commandArguments: IArgument[] = [];
      const commandOptions: IOption[] = [];
      getCommandDecoratorFields(commandInstance, this.initedCommands, {
        commandArguments,
        commandOptions,
      });
      const command = this.createCommand(
        commandInstance,
        commandOptions,
        commandArguments
      );
      parser.addCommand(command);
    }
  }

  private initCommandClass(CommandClass: { new (): Command }): InitedCommand {
    const command: Command = new CommandClass();
    const subCommands: InitedCommand[] = [];

    if (isGroupCommand(command)) {
      const subCommandClasses = command.subCommandClasses;
      for (const LeafCommandClass of subCommandClasses) {
        const subCommandClass = this.initCommandClass(LeafCommandClass);
        subCommands.push(subCommandClass);
      }
    }

    return { command, subCommands };
  }

  private getAlias(command: Command): string | undefined {
    if (command.aliases?.length) {
      return command.aliases[0];
    }
  }

  private createCommand(
    command: Command,
    commandOptions: IOption[],
    commandArguments: IArgument[]
  ): Argv.Command {
    const aggregation = findFirstAggregration(command);
    const commandDefinition = new Argv.Command(
      command.name,
      command.description,
      { sibling: aggregation?.command, alias: this.getAlias(command) }
    );
    for (const option of commandOptions) {
      commandDefinition.withOption(option);
    }
    for (const argument of commandArguments) {
      commandDefinition.withPositional(argument);
    }
    commandDefinition.meta = {};
    commandDefinition.meta.instance = command;
    commandDefinition.meta.instance.siblingProperty = aggregation?.property;

    return commandDefinition;
  }
}

/**
 * Initialize all command classes from the given roots
 *
 * @param options Initialization parameters for the CLI
 */
export async function cli(options: ICli): Promise<CommandBuilder> {
  const { rootCommandClasses, optionParameters, testArguments } = options;
  const printer = options.printer || createDefaultPrinter();
  const parser = Argv.createParser({ printer });

  if (optionParameters) {
    for (const option of optionParameters) {
      parser.addGlobalOption(option);
    }
  }
  const argv: string[] = testArguments || process.argv.slice(2);
  const builder = new CommandBuilder(parser, argv, rootCommandClasses);

  if (builder.runnable) {
    try {
      await builder.runnable.run();
    } catch (error) {
      printer.printHeading(
        printer.formatImportant(printer.getGenericErrorMessage())
      );
      printer.print("");
      printer.printError(error.message);
    }
  }

  return builder;
}

export {
  GroupCommand,
  LeafCommand,
  Argument,
  ExternalOption,
  Option,
  Aggregation,
  Command,
  InitedCommand,
  IOption,
};

export const Utils = {
  isGroupCommand,
  getCommandInstance,
};
export default cli;
