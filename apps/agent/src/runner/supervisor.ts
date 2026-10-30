import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { UnsupportedPlatformError } from './errors'
import { copyBuild, type createInstaller, type RunnerBuild } from './install'
import {
  clearStaleRunners,
  type RunnerProcess,
  spawnRunner,
  stopRunner,
} from './process'

// A runner the plane handed out, with the config it starts with.
export type RunnerStart = { id: string; name: string; config: string }

type Runner = {
  id: string
  name: string
  stopping: boolean
  process?: RunnerProcess
  // Set once it's done: its exit code, or null if it never ran.
  exitCode?: number | null
}

type Options = {
  runnersDir: string
  installer: Pick<ReturnType<typeof createInstaller>, 'ensure'>
  // Tells the plane a runner is done. Throws if the plane can't be told.
  report: (id: string, exitCode: number | null) => Promise<void>
  log?: (line: string) => void
  spawn?: typeof spawnRunner
}

// Runs the runners the plane hands out, each in a directory of its own,
// from start to reported exit.
export const createSupervisor = ({
  runnersDir,
  installer,
  report,
  log = console.log,
  spawn = spawnRunner,
}: Options) => {
  const runners = new Map<string, Runner>()

  const run = async (
    runner: Runner,
    start: RunnerStart,
    build: RunnerBuild,
  ) => {
    const dir = join(runnersDir, runner.id)
    try {
      // Stopping a runner's process tree needs process groups, and its
      // binaries are run.sh-based: Windows needs its own handling.
      if (process.platform === 'win32') throw new UnsupportedPlatformError()
      const installed = await installer.ensure(build)
      if (runner.stopping) return null
      await mkdir(runnersDir, { recursive: true, mode: 0o700 })
      await copyBuild(installed, dir)
      if (runner.stopping) return null
      log(`starting runner ${runner.name}`)
      runner.process = await spawn(dir, start.config, (line) =>
        log(`[${runner.name}] ${line}`),
      )
      const exitCode = await runner.process.exited
      log(`runner ${runner.name} exited with ${exitCode}`)
      return exitCode
    } catch (error) {
      log(
        `runner ${runner.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  return {
    // Clears what a previous agent left behind. Call before the first poll:
    // the plane releases what that agent held once it's not listed.
    clearStale: () => clearStaleRunners(runnersDir),

    // The runners held, to list in polls: running, starting, or exited but
    // not yet reported.
    held: () => [...runners.keys()],

    // Whether no runner is held anymore.
    get idle() {
      return runners.size === 0
    },

    // Whether every runner held is done, if not yet reported.
    get allExited() {
      return [...runners.values()].every(
        (runner) => runner.exitCode !== undefined,
      )
    },

    start(start: RunnerStart, build: RunnerBuild) {
      if (runners.has(start.id)) return
      const runner: Runner = { id: start.id, name: start.name, stopping: false }
      runners.set(start.id, runner)
      void run(runner, start, build).then((exitCode) => {
        runner.exitCode = exitCode
      })
    },

    // Stops a runner, if it's held.
    async stop(id: string) {
      const runner = runners.get(id)
      if (!runner || runner.stopping) return
      runner.stopping = true
      log(`stopping runner ${runner.name}`)
      if (runner.process) await stopRunner(runner.process)
    },

    async stopAll() {
      await Promise.all([...runners.keys()].map((id) => this.stop(id)))
    },

    // Reports the runners that are done, dropping those the plane was told
    // about. The rest are retried next time.
    async reportExited() {
      for (const runner of runners.values()) {
        if (runner.exitCode === undefined) continue
        try {
          await report(runner.id, runner.exitCode)
          runners.delete(runner.id)
        } catch (error) {
          log(
            `reporting runner ${runner.name}'s exit failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          return
        }
      }
    },
  }
}

export type Supervisor = ReturnType<typeof createSupervisor>
