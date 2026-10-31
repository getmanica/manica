import { expect, test } from 'bun:test'
import type { Config } from './config'
import { TokenRejectedError } from './errors'
import { runLive } from './live'
import type { Plane } from './plane'
import type { Supervisor } from './runner/supervisor'

const config = {
  plane: { url: new URL('http://plane.test'), token: 'mna_x', pollInterval: 1 },
  dataDir: '/unused',
} satisfies Config

const build = { version: '1.0.0', url: 'unused', sha256: 'unused' }

type Poll = { accepting: boolean; runners: string[] }
type PollReply = {
  start: { id: string; name: string; config: string }[]
  cancel: string[]
  runner: typeof build | null
}

// A plane answering polls from `replies`, then with nothing to do.
const fakePlane = (replies: (PollReply | { status: number })[]) => {
  const polls: Poll[] = []
  const plane = {
    agent: {
      poll: {
        post: async (body: Poll) => {
          polls.push(body)
          const reply = replies.shift() ?? {
            start: [],
            cancel: [],
            runner: build,
          }
          return 'status' in reply
            ? { data: null, error: { status: reply.status, value: null } }
            : { data: { ...reply, leaseSeconds: 60 }, error: null }
        },
      },
    },
  }
  return { polls, plane: plane as unknown as Plane }
}

// A supervisor whose runners run until stopped.
const fakeSupervisor = () => {
  const held = new Map<string, { exited: boolean }>()
  const started: string[] = []
  const stopped: string[] = []
  const supervisor = {
    clearStale: async () => {},
    held: () => [...held.keys()],
    get idle() {
      return held.size === 0
    },
    get allExited() {
      return [...held.values()].every(({ exited }) => exited)
    },
    start: ({ id }: { id: string }) => {
      started.push(id)
      held.set(id, { exited: false })
    },
    stop: async (id: string) => {
      stopped.push(id)
      const runner = held.get(id)
      if (runner) runner.exited = true
    },
    stopAll: async () => {
      for (const id of held.keys()) await supervisor.stop(id)
    },
    reportExited: async () => {
      for (const [id, { exited }] of held) if (exited) held.delete(id)
    },
  }
  return { started, stopped, supervisor: supervisor as unknown as Supervisor }
}

const shutdown = () => {
  const drain = new AbortController()
  const stop = new AbortController()
  return { drain, stop, signals: { drain: drain.signal, stop: stop.signal } }
}

const start = (id: string) => ({ id, name: `manica-${id}`, config: 'jit' })

test('starts and stops runners as the plane says, and lists them', async () => {
  const { plane, polls } = fakePlane([
    { start: [start('a')], cancel: [], runner: build },
    { start: [], cancel: ['a'], runner: build },
  ])
  const { supervisor, started, stopped } = fakeSupervisor()
  const { drain, signals } = shutdown()
  const live = runLive(config, plane, supervisor, signals)
  while (polls.length < 3) await Bun.sleep(5)
  drain.abort()
  await live

  expect(started).toEqual(['a'])
  expect(stopped).toEqual(['a'])
  expect(polls[1]).toEqual({ accepting: true, runners: ['a'] })
})

test('drains: takes no new jobs, and waits for running ones', async () => {
  const { plane, polls } = fakePlane([
    { start: [start('a')], cancel: [], runner: build },
  ])
  const { supervisor } = fakeSupervisor()
  const { drain, stop, signals } = shutdown()
  const live = runLive(config, plane, supervisor, signals)
  while (polls.length < 1) await Bun.sleep(5)
  drain.abort()
  await Bun.sleep(20)
  expect(polls.at(-1)).toEqual({ accepting: false, runners: ['a'] })

  // A second signal stops the running one.
  stop.abort()
  await live
  expect(supervisor.idle).toBe(true)
})

test('keeps polling through plane outages', async () => {
  const { plane, polls } = fakePlane([{ status: 503 }, { status: 500 }])
  const { supervisor } = fakeSupervisor()
  const { drain, signals } = shutdown()
  const live = runLive(config, plane, supervisor, signals)
  while (polls.length < 3) await Bun.sleep(5)
  drain.abort()
  await live
})

test('gives up on a rejected token', async () => {
  const { plane } = fakePlane([{ status: 401 }])
  const { supervisor } = fakeSupervisor()
  const { signals } = shutdown()
  await expect(
    runLive(config, plane, supervisor, signals),
  ).rejects.toBeInstanceOf(TokenRejectedError)
})
