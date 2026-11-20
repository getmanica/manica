import { parse } from '@bomb.sh/args'
import { UsageError } from './errors'

export const usage = `Usage: manica-agent [command] [options]

Runs the Manica agent: picks up CI jobs from the plane and runs them, until
interrupted (once to let running jobs finish, twice to stop them).

Commands:
  doctor                  Check the config, the plane, and which VM backends
                          this machine can run jobs with, then exit

Options:
  -c, --config-dir <dir>  Directory holding config.toml
                          (default: $XDG_CONFIG_HOME/manica)
  -h, --help              Show this help
  -v, --version           Show the version`

const COMMANDS = ['doctor'] as const
type Command = (typeof COMMANDS)[number]

const known = new Set(['_', 'config-dir', 'c', 'help', 'h', 'version', 'v'])

const isCommand = (arg: string): arg is Command =>
  (COMMANDS as readonly string[]).includes(arg)

export const parseCli = (argv: string[]) => {
  const args = parse(argv, {
    boolean: ['help', 'version'],
    string: ['config-dir'],
    alias: { c: 'config-dir', h: 'help', v: 'version' },
  })
  const unknown = Object.keys(args).find((key) => !known.has(key))
  if (unknown) throw new UsageError(`Unknown option: ${unknown}`)
  const [first, ...rest] = args._.map(String)
  if (first !== undefined && !isCommand(first)) {
    throw new UsageError(`Unknown command: ${first}`)
  }
  if (rest.length > 0) throw new UsageError(`Unexpected argument: ${rest[0]}`)
  if (args['config-dir'] === '') {
    throw new UsageError('--config-dir needs a directory')
  }
  return {
    command: first ?? ('run' as const),
    help: args.help,
    version: args.version,
    configDir: args['config-dir'],
  }
}
