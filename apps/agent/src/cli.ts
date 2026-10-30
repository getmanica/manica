import { parse } from '@bomb.sh/args'
import { UsageError } from './errors'

export const usage = `Usage: manica-agent [options]

Runs the Manica agent: picks up CI jobs from the plane and runs them, until
interrupted (once to let running jobs finish, twice to stop them).

Options:
  -c, --config-dir <dir>  Directory holding config.toml
                          (default: $XDG_CONFIG_HOME/manica)
  -h, --help              Show this help
  -v, --version           Show the version`

const known = new Set(['_', 'config-dir', 'c', 'help', 'h', 'version', 'v'])

export const parseCli = (argv: string[]) => {
  const args = parse(argv, {
    boolean: ['help', 'version'],
    string: ['config-dir'],
    alias: { c: 'config-dir', h: 'help', v: 'version' },
  })
  const unknown = Object.keys(args).find((key) => !known.has(key))
  if (unknown) throw new UsageError(`Unknown option: ${unknown}`)
  if (args._.length > 0) {
    throw new UsageError(`Unexpected argument: ${args._[0]}`)
  }
  if (args['config-dir'] === '') {
    throw new UsageError('--config-dir needs a directory')
  }
  return {
    help: args.help,
    version: args.version,
    configDir: args['config-dir'],
  }
}
