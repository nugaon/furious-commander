import * as Argv from 'cafe-args'
import 'reflect-metadata'
import { Aggregation, findFirstAggregration } from './aggregation'
import { Application } from './application'
import { Argument, getArgument, IArgument } from './argument'
import { maybeAutocomplete, maybeGenerateAutocompletion, maybeInstallAutocompletion } from './autocomplete'
import { Command, GroupCommand, InitedCommand, isGroupCommand, LeafCommand } from './command'
import { ExternalOption, getExternalOption, getOption, IOption, Option } from './option'
import { createDefaultPrinter, Printer } from './printer'
import { getCommandInstance } from './utils'

type Sourcemap = Record<string, 'default' | 'env' | 'explicit'>

let sourcemap: Sourcemap = {}

interface ICli {
  /**
   * Array of the **Root** Command Classes
   */
  rootCommandClasses: { new (): Command }[]
  /**
   * Array of the **Root** options of the CLI
   */
  optionParameters?: IOption[]
  /**
   * test arguments in order to testing the CLI's behaviour
   */
  testArguments?: Array<string>
  /**
   * Functions used to print messages to the CLI
   */
  printer?: Printer
  /**
   * Application metadata for printing customised messages
   */
  application?: Application
}

interface CommandDecoratorData {
  commandOptions: IOption[]
  commandArguments: IArgument[]
}

/**
 * Fetches the given instance Argument, Option and Aggregation configs
 *
 * @param target Command instance
 * @returns all decorated metadata of the Command instance
 */
function getCommandDecoratorData<T extends Command>(target: T): CommandDecoratorData {
  const commandOptions: IOption[] = []
  const commandArguments: IArgument[] = []
  // eslint-disable-next-line guard-for-in
  for (const instanceKey in target) {
    const option = getOption(target, instanceKey)

    if (option) {
      commandOptions.push(option)
      continue
    }

    const argument = getArgument(target, instanceKey)

    if (argument) {
      commandArguments.push(argument)
      continue
    }
  }

  return {
    commandOptions,
    commandArguments,
  }
}

/**
 * Recursive regard of aggregated relation of the starting command
 * resolves aggregated relations
 *
 * @return
 */
function getCommandDecoratorFields<T extends Command>(target: T, allDecoratorData: CommandDecoratorData) {
  const commandDecoratorData = getCommandDecoratorData(target)
  // add fetched decorator data to the total
  allDecoratorData.commandArguments.push(...commandDecoratorData.commandArguments)
  allDecoratorData.commandOptions.push(...commandDecoratorData.commandOptions)
}

/**
 * Assigns the required CLI argument and option values to the given Command instance
 *
 * @param target Command instance
 * @param options CLI arguments which was mapped to this map object by yargs
 */
function initCommandFields<T extends Command>(target: T, options: { [key: string]: unknown }) {
  // eslint-disable-next-line guard-for-in
  for (const key in target) {
    const option = getOption(target, key)

    if (option) {
      const value = options[option.key]

      if (value === undefined) {
        continue
      }
      target[key] = value as T[Extract<keyof T, string>]
      continue
    }

    const externalOptionKey = getExternalOption(target, key)

    if (externalOptionKey) {
      const value = options[externalOptionKey]

      if (value === undefined) {
        continue
      }
      target[key] = value as T[Extract<keyof T, string>]
      continue
    }
    const argument = getArgument(target, key)

    if (argument) {
      const value = options[argument.key]

      if (value === undefined) {
        continue
      }
      target[key] = value as T[Extract<keyof T, string>]
      continue
    }
  }
}

class CommandBuilder {
  /**
   * Used for tests as well
   */
  public initedCommands: InitedCommand[]
  public runnable?: LeafCommand
  public parser: Argv.Parser
  public context!: Argv.Context | string

  public constructor(parser: Argv.Parser) {
    this.parser = parser
    this.initedCommands = []
  }

  public async initCommandClasses(argv: string[], commands: { new (): Command }[], options: ICli): Promise<void> {
    for (const CommandClass of commands) {
      this.initedCommands.push(this.initCommandClass(CommandClass))
    }

    for (const initedCommand of this.initedCommands) {
      this.initCommandInstance(this.parser, initedCommand)
    }

    await maybeAutocomplete(argv, this.parser)

    if (options.application?.command) {
      await maybeGenerateAutocompletion(argv, options.application.command)
      await maybeInstallAutocompletion(argv, options.application.command)
    }

    this.context = this.parser.parse(argv)

    if (typeof this.context === 'string' || this.context.exitReason || !this.context.command?.meta?.instance) {
      return
    }

    sourcemap = this.context.sourcemap

    const command = this.context.command.meta.instance as Command

    initCommandFields(command, {
      ...this.context.options,
      ...this.context.arguments,
    })

    if (this.context.sibling) {
      const key: string = this.context.command.meta.instance.siblingProperty as string
      const siblingCommand: Command = this.context.sibling.command.meta.instance as Command
      Reflect.set(command, key, siblingCommand)
      initCommandFields(this.context.sibling.command.meta.instance as Command, {
        ...this.context.sibling.options,
        ...this.context.sibling.arguments,
      })
    }
    this.runnable = this.context.command.meta.instance as LeafCommand
  }

  private createGroup(command: GroupCommand, commandArguments: IArgument[], commandOptions: IOption[]): Argv.Group {
    const group = new Argv.Group(command.name, command.description)
    getCommandDecoratorFields(command, {
      commandArguments,
      commandOptions,
    })
    for (const SubcommandClass of command.subCommandClasses) {
      const initedSubcommand = new SubcommandClass()

      if (isGroupCommand(initedSubcommand)) {
        const childGroup = this.createGroup(initedSubcommand, [...commandArguments], [...commandOptions])
        group.withGroup(childGroup)
      } else {
        const command = this.createCommand(initedSubcommand, [...commandOptions], [...commandArguments])
        group.withCommand(command)
      }
    }

    return group
  }

  private initCommandInstance(parser: Argv.Parser, initedCommand: InitedCommand): void {
    const commandInstance = initedCommand.command

    if (isGroupCommand(commandInstance)) {
      const group = this.createGroup(commandInstance, [], [])
      parser.addGroup(group)
    } else {
      const command = this.createCommand(commandInstance, [], [])
      parser.addCommand(command)
    }
  }

  private initCommandClass(CommandClass: { new (): Command }): InitedCommand {
    const command: Command = new CommandClass()
    const subCommands: InitedCommand[] = []

    if (isGroupCommand(command)) {
      const subCommandClasses = command.subCommandClasses
      for (const SubCommandClass of subCommandClasses) {
        subCommands.push(this.initCommandClass(SubCommandClass))
      }
    }

    return { command, subCommands }
  }

  private getAlias(command: Command): string | undefined {
    if (command.aliases?.length) {
      return command.aliases[0]
    }
  }

  private createCommand(command: Command, commandOptions: IOption[], commandArguments: IArgument[]): Argv.Command {
    getCommandDecoratorFields(command, {
      commandArguments,
      commandOptions,
    })
    const aggregation = findFirstAggregration(command)
    const commandDefinition = new Argv.Command(command.name, command.description, {
      sibling: aggregation?.command,
      alias: this.getAlias(command),
    })
    for (const option of commandOptions) {
      commandDefinition.withOption(option)
    }
    for (const argument of commandArguments) {
      commandDefinition.withPositional(argument)
    }
    commandDefinition.meta = {}
    commandDefinition.meta.instance = command
    commandDefinition.meta.instance.siblingProperty = aggregation?.property

    return commandDefinition
  }
}

/**
 * Initialize all command classes from the given roots
 *
 * @param options Initialization parameters for the CLI
 */
export async function cli(options: ICli): Promise<CommandBuilder> {
  const { rootCommandClasses, optionParameters, testArguments, application } = options
  const printer = options.printer || createDefaultPrinter()
  const parser = Argv.createParser({ printer, application })

  if (optionParameters) {
    for (const option of optionParameters) {
      parser.addGlobalOption(option)
    }
  }
  const builder = new CommandBuilder(parser)
  await builder.initCommandClasses(testArguments || process.argv.slice(2), rootCommandClasses, options)

  if (builder.runnable) {
    try {
      await builder.runnable.run()
    } catch (error) {
      printer.printHeading(printer.formatImportant(printer.getGenericErrorMessage()))
      printer.print('')
      printer.printError(error.message)
    }
  }

  return builder
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
  Sourcemap,
}

export const Utils = {
  isGroupCommand,
  getCommandInstance,
  getSourcemap: (): Sourcemap => sourcemap,
}
export default cli
