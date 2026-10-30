import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as v from 'valibot'
import { ConfigNotFoundError, InvalidConfigError } from './errors'

// Seconds between polls: how soon a queued job is picked up. Runner leases
// last a minute, so polls stay well within that.
const DEFAULT_POLL_INTERVAL_SECONDS = 5
const MAX_POLL_INTERVAL_SECONDS = 20

// Strict objects, so a misspelled key is reported instead of ignored.
const ConfigSchema = v.pipe(
  v.strictObject({
    plane: v.strictObject({
      url: v.pipe(
        v.string(),
        v.url(),
        v.transform((url) => new URL(url)),
        v.check(
          ({ protocol }) => protocol === 'http:' || protocol === 'https:',
          'must be an http(s) URL',
        ),
      ),
      // Defaults to empty so a missing token gets the hint about the env var.
      token: v.pipe(
        v.optional(v.string(), ''),
        v.nonEmpty('is required (or set MANICA_AGENT_TOKEN)'),
      ),
      poll_interval: v.optional(
        v.pipe(
          v.number(),
          v.minValue(1, 'must be at least 1 second'),
          v.maxValue(
            MAX_POLL_INTERVAL_SECONDS,
            `must be at most ${MAX_POLL_INTERVAL_SECONDS} seconds`,
          ),
        ),
        DEFAULT_POLL_INTERVAL_SECONDS,
      ),
    }),
    agent: v.optional(
      v.strictObject({
        // Where runner builds are kept and runners run.
        data_dir: v.optional(v.pipe(v.string(), v.nonEmpty())),
      }),
      {},
    ),
  }),
  v.transform(({ plane: { poll_interval, ...plane }, agent }) => ({
    plane: {
      ...plane,
      // Milliseconds between polls.
      pollInterval: poll_interval * 1000,
    },
    dataDir: agent.data_dir ?? defaultDataDir(),
  })),
)

export type Config = v.InferOutput<typeof ConfigSchema>

// $XDG_CONFIG_HOME/manica, falling back to ~/.config/manica (also on macOS);
// %APPDATA%\manica on Windows.
export const defaultConfigDir = () => {
  if (process.platform === 'win32' && Bun.env.APPDATA) {
    return join(Bun.env.APPDATA, 'manica')
  }
  return join(Bun.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'manica')
}

// $XDG_DATA_HOME/manica, falling back to ~/.local/share/manica (also on
// macOS); %LOCALAPPDATA%\manica on Windows.
export const defaultDataDir = () => {
  if (process.platform === 'win32' && Bun.env.LOCALAPPDATA) {
    return join(Bun.env.LOCALAPPDATA, 'manica')
  }
  return join(
    Bun.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
    'manica',
  )
}

// MANICA_AGENT_TOKEN takes precedence over the token in the file.
const withEnvToken = (raw: Record<string, unknown>) => {
  const token = Bun.env.MANICA_AGENT_TOKEN
  if (!token) return raw
  const { plane } = raw
  return typeof plane === 'object' && plane !== null
    ? { ...raw, plane: { ...plane, token } }
    : raw
}

// Valibot's messages for missing and unknown object keys are generic
// ("Invalid key: Expected never…"), so those two get plain wording.
const describeIssue = (issue: v.BaseIssue<unknown>) => {
  if (issue.type === 'strict_object') {
    if (issue.expected === 'never') return 'unknown key'
    if (issue.input === undefined) return 'is required'
  }
  return issue.message
}

export const loadConfig = async (dir: string): Promise<Config> => {
  const path = join(dir, 'config.toml')
  const file = Bun.file(path)
  if (!(await file.exists())) throw new ConfigNotFoundError(path)

  await warnIfReadableByOthers(path)

  let raw: Record<string, unknown>
  try {
    raw = Bun.TOML.parse(await file.text()) as Record<string, unknown>
  } catch (error) {
    throw new InvalidConfigError(
      path,
      error instanceof Error ? error.message : String(error),
    )
  }

  const result = v.safeParse(ConfigSchema, withEnvToken(raw))
  if (!result.success) {
    const reasons = result.issues.map(
      (issue) => `${v.getDotPath(issue) ?? '(root)'}: ${describeIssue(issue)}`,
    )
    throw new InvalidConfigError(path, reasons.join('; '))
  }
  return result.output
}

// The config holds the agent token, so it shouldn't be readable by others.
const warnIfReadableByOthers = async (path: string) => {
  if (process.platform === 'win32') return
  const { mode } = await stat(path)
  if (mode & 0o077) {
    console.warn(
      `warning: ${path} is accessible by other users; run: chmod 600 ${path}`,
    )
  }
}
