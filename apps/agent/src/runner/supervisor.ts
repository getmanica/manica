import type { RunnerHost } from './host'
import type { RunnerBuild } from './install'

// A runner the plane handed out, with the config it starts with.
export type RunnerStart = { id: string; name: string; config: string }

type Runner = {
  id: string
  name: string
  stop: AbortController
  done: Promise<void>
  // Set once it's done: its exit code, or null if it never ran.
  exitCode?: number | null
}

type Options = {
  host: RunnerHost
  // Tells the plane a runner is done. Throws if the plane can't be told.
  report: (id: string, exitCode: number | null) => Promise<void>
  log?: (line: string) => void
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// Runs the runners the plane hands out on `host`, from start to reported
// exit.
export const createSupervisor = ({
  host,
  report,
  log = console.log,
}: Options) => {
  const runners = new Map<string, Runner>()

  const run = async (
    runner: Runner,
    start: RunnerStart,
    build: RunnerBuild,
  ) => {
    try {
      const exitCode = await host.run(
        { ...start, build },
        {
          signal: runner.stop.signal,
          log,
          output: (line) => log(`[${runner.name}] ${line}`),
        },
      )
      if (exitCode !== null) {
        log(`runner ${runner.name} exited with ${exitCode}`)
      }
      return exitCode
    } catch (error) {
      log(`runner ${runner.name} failed: ${describe(error)}`)
      return null
    }
  }

  return {
    // Clears what a previous agent left behind. Call before the first poll:
    // the plane releases what that agent held once it's not listed.
    clearStale: () => host.clearStale(),

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
      const runner: Runner = {
        id: start.id,
        name: start.name,
        stop: new AbortController(),
        done: Promise.resolve(),
      }
      runners.set(start.id, runner)
      runner.done = run(runner, start, build).then((exitCode) => {
        runner.exitCode = exitCode
      })
    },

    // Stops a runner, if it's held, resolving once it's done.
    async stop(id: string) {
      const runner = runners.get(id)
      if (!runner) return
      if (!runner.stop.signal.aborted) {
        log(`stopping runner ${runner.name}`)
        runner.stop.abort()
      }
      await runner.done
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
            `reporting runner ${runner.name}'s exit failed: ${describe(error)}`,
          )
          return
        }
      }
    },
  }
}

export type Supervisor = ReturnType<typeof createSupervisor>
