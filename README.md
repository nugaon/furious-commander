# Furious Commander

[![Tests](https://github.com/nugaon/furious-commander/actions/workflows/test.yaml/badge.svg)](https://github.com/nugaon/furious-commander/actions/workflows/test.yaml)

Furious Commander is a testable CLI framework, which uses [decorators](https://www.typescriptlang.org/docs/handbook/decorators.html) and classes to specify commands in any depth and easily define and use CLI `arguments` and `options`.

## Install

```sh
 $ npm install --save furious-commander
```

## Usage

You can create Command classes to construct the command tree, and assign functionalities.

Basically, there are two kind of Commands: `LeafCommand` and `GroupCommand`.
These are also available as interfaces, which can help you to implement the required fields and methods.

There is a sample in the [test/test-commands.ts](test/test-commands.ts) file how you can utilize the possibilities of this framework in your application. (This file also used in Jest tests)

An example of a leaf command:
```ts
import { Option, ExternalOption, Argument, LeafCommand } from 'furious-commander'

export class TestLeafCommand implements LeafCommand {
  public readonly name = 'testCommand'

  public readonly description = 'This is a testcommand'

  @Option({ key: 'option-test-command-1', description: 'Test option 1 for TestLeafCommand' })
  public option1!: string

  @Argument({ key: 'argument-1', description: 'test argument for TestLeafCommand', required: true })
  public argument1!: string

  @ExternalOption('api-url')
  public apiUrl!: string

  @ExternalOption('group-option-1')
  public groupOption!: string

  public run(): void {
    console.log(`I'm ${this.name}. option-test-command-1: ${this.option1}.`)
    console.log(' I COMMAND!!!!!4!')
    // (...)
  }
}
```

and a group command:
```ts
import { Option, ExternalOption, Argument, GroupCommand } from 'furious-commander'

export class TestGroupCommand implements GroupCommand {
  public readonly name = 'testGroupCommand'

  public subCommandClasses = [TestLeafCommand]

  public readonly description = 'This is a GroupCommand'

  @Option({ key: 'group-option-1', description: 'Test option 1 for export class TestGroupCommand' })
  public option1!: string
}
```

Other "root level" `options` and configuration of the CLI can be passed on the invocation of the `cli` method.
This method initializes all your passed root Command classes, until its last LeafCommands (and make it available for later).
For this you can find example in [test/index.spec.ts](test/index.spec.ts)

example for `cli` method call with the command class above:

```ts
const commandBuilder = await cli({
  rootCommandClasses: [TestGroupCommand],
  optionParameters: [
    {
      key: 'api-url',
      description: 'URL of the EP that I will Command!',
      default: 'http://obedient-service.local',
    },
  ],
})
```

Through the `commandBuilder` object, the initialized classes are reachable.

If you build successfully your cli project (e.g. `#!/usr/bin/env node` presents at the top of the source file...) You can call the command with the setup above:

```sh
 $ <your-cli-app> testGroupCommand testCommand testargument --api-url http://localhost:8080
```

This will invoke the testCommand's (async) `run` method, after its fields initialized by Furious Commander.

### Conditional Required

When an option is required, you can simply specify `{ required: true }` and the parser will print a helpful error message every time the user tries running your application without providing that option.

This may not always be your use-case though. Let's say you have an `--interactive` global option, which enables some features, such as allowing the user to provide a value (for that option) in your application logic, after the parser has run.

For such cases, the `required` property can take `{ when: string }` and `{ unless: string }` values, where the strings represent the dependee keys.

Following the previous example, you may want to specify `{ required: { unless: 'interactive' } }`, and the option will no longer throw error when running with the `--interactive` option (or its alias).

The reverse of this situation when you have these features enabled by default, but your application has a `--silent` or `--quiet` mode, where you do not allow any interactivity and the required options must all be passed beforehand. To indicate this, use `{ required: { when: 'quiet' } }`.

### Aggregation

The framework support aggregated relations between independent commands.
It means, one command is able to reach the properties of other command.
The configurations of the referenced aggregated command will be applied to the base class, that defines the relation.
In order to build up this relation, an arbitrary field of the class has to be decorated with `Aggregation`.

A sample class to show how it is possible
```ts
import { Aggregation } from 'furious-commander'

export class TestCommand {

  @Aggregation(['group-command', 'furious-command']) // CLI path of the referenced Command
  public aggregatedRelation!: FuriousCommand // Type in here the class of the aggregated command

  // (...)
}
```
By this, `TestCommand` can invoke any function of `FuriousCommand`, and `FuriousCommand` all Options and Arguments have been initialized by the framework.
Of course, all required parameters of aggregated relations have to be defined in the CLI call.
For instance, `FuriousCommand` has required argument `argument-1`, when calling `TestCommand`, `argument-1` has to be passed as well even if it is not defined directly in `TestCommand`.

You can see this functionality in action on test `should reach aggregated command fields`.

### Allow only either one param

It is possible to allow only one parameter of the given option/argument key set.
This key set consists required parameters for the successful run, but only one of them has to be defined.

```ts
export class TestCommand13 implements LeafCommand {
  public readonly name = 'testCommand13'

  public readonly description = 'This is the testcommand13'

  @Option({ key: 'option1', description: 'Test option1 for TestCommand13', required: true, conflicts: 'option2' })
  public option1!: string;

  @Option({ key: 'option2', description: 'Test option2 for TestCommand13', required: true, conflicts: 'option1' })
  public option2!: string;

  public run(): void {
    // (...)
  }
}
```

By this setup I cannot call `TestCommand13` with both options `option1` and `option2`, but I have to pass at least one of these.

### Check where the value of an option or argument originates from

Suppose you have an option which has a default value and may also be specified via `process.env`. To indicate this, the option receives the `default` and `envKey` properties.

```ts
import { Option } from 'furious-commander'

@Option({ key: 'host', description: 'Host', envKey: 'HOST', default: 'http://localhost' })
public host!: string;
```

Later on, you may want to know where its value came from - whether it was specified with `--host` explicitly, got its value from `process.env`, or used the default value.

To learn this information, use `Utils.getSourcemap()` after calling the `cli`.

```ts
import { Utils } from 'furious-commander'

process.env.HOST = '...'

const sourcemap = Utils.getSourcemap()

sourcemap.host // 'env'
```

`sourcemap[key]` holds values `'explicit'`, `'env'`, `'default'` or `undefined` accordingly.

### Customised messages

There are two ways to customise the content and style of printed messages: the `application` and `printer` options.

#### Printer

To control how the framework prints help and error messages, implement the `Printer` interface and pass it to `cli`.

The following example uses ANSI escape codes to make important messages bold, dim messages grayed out, and adds `>` and `!` characters before headings and errors respectively.

```ts
{
  print: text => console.log(text),
  printError: text => console.error('! ' + text),
  printHeading: text => console.log('> ' + text),
  formatDim: text => '\x1b[2m' + text + '\x1b[0m',
  formatImportant: text => '\x1b[1m' + text + '\x1b[0m',
  getGenericErrorMessage: () => 'Failed to run command!',
}
```

#### Application

Some messages refer to your application by its name or its command for customised, user friendly messages and usage examples.

This can be controlled by passing an `application` property of interface `Application` when invoking `cli`.

```ts
{
  name: 'Furious Commander',
  command: 'furious-commander',
  version: '1.0.0',
  description: 'Powered by furious technologies'
}
```

Having done that, *help* will include messages such as these:

```
Furious Commander 1.0.0 - Powered by furious technologies
```

and

```
Usage:

furious-commander http get <url> [OPTIONS]
```

### Human-Readable Numbers

Numbers and BigInts may be formatted with underscores (`_`) at will for better readability:

```
--price 100_000_000
```

Underscores are simply omitted before the parsing cycle. They can appear anywhere and you may have as many of them as you want.

Furthermore, you can use the following shorthand units:

```
| Unit     | Lower | Upper | Example  |
|----------|-------|-------|----------|
| Thousand | k     | K     | 120K     |
| Million  | m     | M     | 84m      |
| Billion  | b     | B     | 200_000B |
| Trillion | t     | T     | 19t      |
```

### Hex-Strings

There is a built-in `hex-string` type that does the following checks and transformations:

- Ensures only `a-f` and `0-9` characters are given
- Allows uppercase, but transforms to lowercase
- Allows `0x` prefix, but omits it
- Checks for even length, unless `oddLength: true` property is given
- Obeys `length`, `minimumLength` and `maximumLength` rules

### Autocomplete

All commands support autocomplete out of the box. The currently supported shells are `bash`, `zsh` and `fish`. `bash` uses `complete` and `COMPREPLY`, `zsh` uses `compdef` and `compadd`, `fish` uses `complete` (which is different from `bash` `complete`).

If an option or argument should accept and autocomplete a path, add the `autocompletePath` property.

To enable autocompletion, the end user has to install it automatically or manually.

`--generate-completion` will print the shell, configuration path and the autocomplete script.

`--install-completion` appends it to the file at the configuration path additionally.

Autocomplete only needs to be installed once, as the suggestions are handled dynamically by the application - meaning future changes will be picked up automatically.

This is achieved by calling the application with the `--compgen` flag, as well as `--compfish`, `--compzsh` or `--compbash` accordingly, and the actual line (or "buffer") that is being written by the end user.

## Setup your project

In order to use decorators in your project (until it's not available in vanilla JS) you should use `typescript` with the following configuration:

```JSON
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    // (...)
  }
  // (...)
}
```

For babel use `@babel/plugin-proposal-decorators` (suggested with `legacy: true`) followed by `@babel/plugin-proposal-class-properties` plugins.

## Test

```sh
 $ npm run test
```
