import { VmCommandError } from './errors'

export type CommandResult = { exitCode: number; stdout: string; stderr: string }

type RunOptions = {
  // Throw if it exits with anything but 0.
  check?: boolean
  // Kills it when aborted.
  signal?: AbortSignal
  env?: Record<string, string | undefined>
}

// Runs a command to completion, collecting its output. Throws a
// VmCommandError if it can't be started, or if it fails and `check` is set
// (as it does once killed through `signal`).
export const runCommand = async (
  argv: string[],
  { check = true, signal, env = process.env }: RunOptions = {},
): Promise<CommandResult> => {
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    child = Bun.spawn(argv, {
      env: { ...env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
    })
  } catch (error) {
    throw new VmCommandError(argv, null, String(error))
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    child.stdout.text(),
    child.stderr.text(),
    child.exited,
  ])
  if (check && exitCode !== 0) {
    throw new VmCommandError(argv, exitCode, stderr.trim())
  }
  return { exitCode, stdout, stderr }
}

// Calls `log` with each line `stream` carries.
export const forwardLines = async (
  stream: ReadableStream<Uint8Array>,
  log: (line: string) => void,
) => {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const bytes of stream) {
    const lines = (buffered + decoder.decode(bytes, { stream: true })).split(
      '\n',
    )
    buffered = lines.pop() ?? ''
    for (const line of lines) log(line)
  }
  if (buffered) log(buffered)
}

// Compares dotted versions numerically: negative if a < b.
export const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
