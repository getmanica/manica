import type { Config } from './config'
import { TokenRejectedError } from './errors'
import type { Plane } from './plane'
import type { Supervisor } from './runner/supervisor'

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// Eden reports network failures (no response at all) as a 503 whose value is
// the underlying error; API errors carry a human-readable `detail`.
const describeResponseError = ({
  status,
  value,
}: {
  status: number
  value: unknown
}) => {
  if (value instanceof Error) return value.message
  const detail = (value as { detail?: unknown } | null)?.detail
  return typeof detail === 'string'
    ? `HTTP ${status}: ${detail}`
    : `HTTP ${status}`
}

// Calls the plane, turning failures into errors: a rejected token is fatal,
// since retrying can't fix it; anything else is worth retrying.
const call = async <T>(
  request: () => Promise<
    | { data: T; error: null }
    | { data: null; error: { status: number; value: unknown } }
  >,
): Promise<T> => {
  const { data, error } = await request()
  if (error) {
    if (error.status === 401) throw new TokenRejectedError()
    throw new Error(describeResponseError(error))
  }
  return data
}

// Tells the plane a runner is done.
export const reportExit =
  (plane: Plane) => (id: string, exitCode: number | null) =>
    call(() => plane.agent.runners({ id }).exited.post({ exitCode })).then(
      () => undefined,
    )

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

// Signals for shutting down: `drain` stops taking jobs and waits for the
// running ones, `stop` stops them too.
export type Shutdown = { drain: AbortSignal; stop: AbortSignal }

// Polls the plane every poll interval: reports the runners it holds, starts
// the ones the plane hands out, and stops the ones the plane gave up on.
// Returns once shut down and every runner is done (and reported, while the
// plane can be reached).
export const runLive = async (
  config: Config,
  plane: Plane,
  supervisor: Supervisor,
  shutdown: Shutdown,
) => {
  console.log(`connecting to ${config.plane.url.origin}`)
  await supervisor.clearStale()

  let connected = false
  let stopping = false
  while (true) {
    if (shutdown.stop.aborted && !stopping) {
      stopping = true
      void supervisor.stopAll()
    }
    await supervisor.reportExited()
    const accepting = !shutdown.drain.aborted
    if (!accepting && supervisor.idle) break

    try {
      const polled = await call(() =>
        plane.agent.poll.post({ accepting, runners: supervisor.held() }),
      )
      if (!connected) console.log('connected')
      connected = true
      for (const id of polled.cancel) void supervisor.stop(id)
      if (polled.runner) {
        for (const start of polled.start) {
          supervisor.start(start, polled.runner)
        }
      }
    } catch (error) {
      if (error instanceof TokenRejectedError) {
        await supervisor.stopAll()
        throw error
      }
      if (connected) console.error('lost connection to the plane, retrying')
      console.error(`poll failed: ${describe(error)}`)
      connected = false
      // Stopping with the plane unreachable: no one to report to.
      if (stopping && supervisor.allExited) break
    }

    // Once stopping, the stop signal no longer cuts the wait short.
    await sleep(
      config.plane.pollInterval,
      stopping ? new AbortController().signal : shutdown.stop,
    )
  }
}
