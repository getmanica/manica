import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { UnsupportedPlatformError } from './errors'
import { copyBuild, type createInstaller, type RunnerBuild } from './install'
import { clearStaleRunners, spawnRunner, stopRunner } from './process'

// One runner to run: the plane's id and name for it, its JIT config, and
// the actions/runner build to run it with.
export type RunnerJob = {
  id: string
  name: string
  config: string
  build: RunnerBuild
}

export type RunOptions = {
  // Aborted to stop the runner, at whatever point it got to.
  signal: AbortSignal
  // The agent's own log.
  log: (line: string) => void
  // The runner's output, line by line.
  output: (line: string) => void
}

// Where runners run: on this machine, or each in a VM of its own.
export type RunnerHost = {
  // Runs a runner to completion and cleans up after it. Resolves with its
  // exit code, or null if it was stopped before it started. Throws if it
  // couldn't be started.
  run(job: RunnerJob, options: RunOptions): Promise<number | null>
  // Clears what a previous agent left behind: the plane gave up on it.
  clearStale(): Promise<void>
}

export type Installer = Pick<ReturnType<typeof createInstaller>, 'ensure'>

type LocalHostOptions = {
  runnersDir: string
  installer: Installer
  spawn?: typeof spawnRunner
}

// Runs each runner on this machine, as the agent's user, from a copy of its
// build in a directory of its own.
export const createLocalHost = ({
  runnersDir,
  installer,
  spawn = spawnRunner,
}: LocalHostOptions): RunnerHost => ({
  clearStale: () => clearStaleRunners(runnersDir),

  async run({ id, name, config, build }, { signal, log, output }) {
    const dir = join(runnersDir, id)
    let stopping: Promise<void> | undefined
    try {
      // Stopping a runner's process tree needs process groups, and its
      // binaries are run.sh-based: Windows needs its own handling.
      if (process.platform === 'win32') throw new UnsupportedPlatformError()
      const installed = await installer.ensure(build)
      if (signal.aborted) return null
      await mkdir(runnersDir, { recursive: true, mode: 0o700 })
      await copyBuild(installed, dir)
      if (signal.aborted) return null
      log(`starting runner ${name}`)
      const runner = await spawn(dir, config, output)
      const stop = () => {
        stopping = stopRunner(runner)
      }
      if (signal.aborted) stop()
      else signal.addEventListener('abort', stop, { once: true })
      const exitCode = await runner.exited
      signal.removeEventListener('abort', stop)
      return exitCode
    } finally {
      // What the runner started may outlive it, until stopRunner is done.
      await stopping
      await rm(dir, { recursive: true, force: true })
    }
  },
})
