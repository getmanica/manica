import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const PID_FILE = '.manica-pid'

// How long a runner gets to stop on SIGTERM before it's killed.
export const STOP_GRACE_MS = 10_000

export type RunnerProcess = {
  pid: number
  exited: Promise<number>
}

// Starts the runner in `dir`, as the leader of a process group of its own,
// so stopping it reaches everything it started (the listener, the worker,
// the job's steps). The config goes in through the environment, which the
// runner reads then clears, rather than the command line, which other
// users can see.
export const spawnRunner = async (
  dir: string,
  config: string,
  log: (line: string) => void,
  command = [join(dir, 'run.sh')],
): Promise<RunnerProcess> => {
  const child = Bun.spawn(command, {
    cwd: dir,
    env: {
      ...process.env,
      ACTIONS_RUNNER_INPUT_JITCONFIG: config,
      // Exit with 7, instead of retrying, on a runner version GitHub
      // deprecated.
      ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE: '1',
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  })
  // Recorded so a later agent can stop it if this one dies first.
  await Bun.write(join(dir, PID_FILE), String(child.pid))
  void forwardLines(child.stdout, log)
  void forwardLines(child.stderr, log)
  return { pid: child.pid, exited: child.exited }
}

const forwardLines = async (
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

const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    // Already gone.
    return false
  }
}

// Stops a runner's process group: SIGTERM, then SIGKILL if it's still
// there after `graceMs`.
export const stopRunner = async (
  runner: RunnerProcess,
  graceMs = STOP_GRACE_MS,
) => {
  signalGroup(runner.pid, 'SIGTERM')
  const timer = setTimeout(() => signalGroup(runner.pid, 'SIGKILL'), graceMs)
  await runner.exited
  clearTimeout(timer)
  // What the runner started may outlive it.
  signalGroup(runner.pid, 'SIGKILL')
}

// Whether the process group `pgid` still runs something from `dir`, rather
// than the pid having been recycled. Its leader may be gone while what it
// started still runs.
const groupRunsFrom = async (pgid: number, dir: string) => {
  const ps = Bun.spawn(['ps', '-A', '-o', 'pgid=,command='], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const output = await ps.stdout.text()
  await ps.exited
  return output.split('\n').some((line) => {
    const [group, ...command] = line.trim().split(/\s+/)
    return Number(group) === pgid && command.join(' ').includes(dir)
  })
}

// Kills the runners a previous agent left behind (it crashed, or was
// killed), and removes their directories: the plane gave up on them.
export const clearStaleRunners = async (runnersDir: string) => {
  const entries = await readdir(runnersDir).catch(() => [])
  for (const entry of entries) {
    const dir = join(runnersDir, entry)
    const pidFile = Bun.file(join(dir, PID_FILE))
    if (await pidFile.exists()) {
      const pid = Number(await pidFile.text())
      if (Number.isInteger(pid) && pid > 0 && (await groupRunsFrom(pid, dir))) {
        console.log(`stopping runner left over in ${dir}`)
        signalGroup(pid, 'SIGKILL')
      }
    }
    await rm(dir, { recursive: true, force: true })
  }
}
