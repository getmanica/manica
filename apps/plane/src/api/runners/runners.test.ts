import { setTimeout as sleep } from 'node:timers/promises'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createAgent, createOrganization } from '../../../test/fixtures'
import { fakeForge, forgesWith } from '../../../test/forge'
import { agentsService } from '../agents/agents.service'
import { AgentBusyError } from '../agents/errors'
import type { Forge, JobEvent } from '../forges/forge'
import { jobsService } from '../jobs/jobs.service'
import { db } from '../platform/db'
import { agent, job, runner } from '../platform/db/schema'
import { createReaper } from './reaper'
import { createRunnersService, LEASE_MS } from './runners.service'

type App = { id: string; organizationId: string }

let app: App
let mac: typeof agent.$inferSelect
let createRunner: ReturnType<typeof vi.fn<Forge['createRunner']>>
let deleteRunner: ReturnType<typeof vi.fn<Forge['deleteRunner']>>
let findRunner: ReturnType<typeof vi.fn<Forge['findRunner']>>
let forge: Forge

let registered = 0

beforeEach(async () => {
  const created = await createOrganization()
  app = { id: created.app.id, organizationId: created.organizationId }
  mac = await createAgent(app.organizationId, { name: 'studio' })
  createRunner = vi.fn<Forge['createRunner']>(async () => {
    registered++
    return { externalRunnerId: String(registered), config: `jit-${registered}` }
  })
  deleteRunner = vi.fn<Forge['deleteRunner']>(async () => 'deleted')
  findRunner = vi.fn<Forge['findRunner']>(async () => undefined)
  forge = fakeForge({ createRunner, deleteRunner, findRunner })
  distribution = { for: async () => runnerBuild }
})

const runnerBuild = {
  version: '2.338.2',
  url: 'https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-osx-arm64-2.338.2.tar.gz',
  sha256: 'a'.repeat(64),
}
let distribution: { for: () => Promise<typeof runnerBuild | undefined> }

const service = () => createRunnersService(forgesWith(forge), distribution)
const reaper = () => createReaper(forgesWith(forge))

let jobs = 0

// Records a job event, as from a webhook.
const record = (overrides: Partial<JobEvent> & { externalId: string }) =>
  jobsService.record(app, {
    type: 'job',
    status: 'queued',
    runId: '10',
    installationId: '7',
    repository: 'acme/widgets',
    name: 'build',
    url: 'https://github.com/acme/widgets/actions/runs/10/job/1',
    labels: ['self-hosted', 'macOS'],
    externalRunnerId: null,
    runnerName: null,
    conclusion: null,
    queuedAt: new Date(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  })

// Queues a new job, returning its forge id.
const queue = async (overrides: Partial<JobEvent> = {}) => {
  const externalId = String(++jobs)
  await record({ ...overrides, externalId })
  return externalId
}

const storedJob = async (externalId: string) => {
  const rows = await db.select().from(job).where(eq(job.forgeAppId, app.id))
  const found = rows.find((row) => row.externalId === externalId)
  if (!found) throw new Error(`No job ${externalId}`)
  return found
}

const storedRunner = async (id: string) => {
  const [found] = await db.select().from(runner).where(eq(runner.id, id))
  if (!found) throw new Error(`No runner ${id}`)
  return found
}

const poll = (
  runners: string[] = [],
  input: { accepting?: boolean; agentId?: string; version?: string } = {},
) =>
  service().poll(input.agentId ?? mac.id, {
    version: input.version,
    accepting: input.accepting ?? true,
    runners,
  })

// Moves the runner's lease into the past.
const expireLease = (id: string) =>
  db
    .update(runner)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(runner.id, id))

describe('poll', () => {
  test('hands out a runner registered for a matching job', async () => {
    const externalId = await queue()
    const { start, leaseSeconds } = await poll()
    expect(start).toHaveLength(1)
    expect(start[0]?.config?.startsWith('jit-')).toBe(true)
    expect(start[0]?.name).toBe(`manica-${start[0]?.id}`)
    expect(leaseSeconds).toBe(LEASE_MS / 1000)
    expect(createRunner.mock.calls[0]?.[0]).toMatchObject({
      installationId: '7',
      repository: 'acme/widgets',
      labels: ['self-hosted', 'macos'],
      name: start[0]?.name,
    })

    const issued = await storedRunner(start[0]?.id ?? '')
    expect(issued).toMatchObject({
      state: 'issued',
      reservedJobId: (await storedJob(externalId)).id,
    })
  })

  test('fills free slots only', async () => {
    await queue()
    await queue()
    const first = await poll()
    expect(first.start).toHaveLength(1)
    // Still holding the first: no slot free.
    expect((await poll(first.start.map(({ id }) => id))).start).toHaveLength(0)

    await db.update(agent).set({ slots: 2 }).where(eq(agent.id, mac.id))
    expect((await poll(first.start.map(({ id }) => id))).start).toHaveLength(1)
  })

  test('skips jobs the agent’s labels don’t cover', async () => {
    await createAgent(app.organizationId, { os: 'linux', arch: 'x86_64' })
    await queue({ labels: ['self-hosted', 'linux'] })
    expect((await poll()).start).toHaveLength(0)
  })

  test('gives a job one runner, however many agents poll for it', async () => {
    const other = await createAgent(app.organizationId)
    await queue()
    const results = await Promise.all([
      poll([], { agentId: mac.id }),
      poll([], { agentId: other.id }),
      poll([], { agentId: mac.id }),
    ])
    expect(results.flatMap(({ start }) => start)).toHaveLength(1)
  })

  test('doesn’t overfill an agent polling concurrently', async () => {
    await queue()
    await queue()
    const results = await Promise.all([poll(), poll(), poll()])
    expect(results.flatMap(({ start }) => start)).toHaveLength(1)
  })

  test('records the version the agent reports', async () => {
    const version = async () => {
      const [found] = await db
        .select({ version: agent.version })
        .from(agent)
        .where(eq(agent.id, mac.id))
      return found?.version
    }
    await poll([], { version: '1.2.3' })
    expect(await version()).toBe('1.2.3')
    // An agent that doesn't report it may be any version.
    await poll()
    expect(await version()).toBeNull()
  })

  test('says which runner build to run', async () => {
    expect((await poll()).runner).toEqual(runnerBuild)
  })

  test('takes nothing new without a runner build to run', async () => {
    distribution = { for: async () => undefined }
    await queue()
    expect(await poll()).toMatchObject({ start: [], runner: null })
  })

  test('takes nothing new from an agent that isn’t accepting', async () => {
    await queue()
    expect((await poll([], { accepting: false })).start).toHaveLength(0)
  })

  test('acknowledges and renews the runners the agent holds', async () => {
    await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    await expireLease(id)
    await poll([id])
    const acked = await storedRunner(id)
    expect(acked.state).toBe('acked')
    expect(acked.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('leaves an issued runner the agent hasn’t received yet to its lease', async () => {
    await queue()
    const [started] = (await poll()).start
    await poll([])
    expect((await storedRunner(started?.id ?? '')).state).toBe('issued')
  })

  test('releases a runner the agent dropped, and requeues its job', async () => {
    await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    await poll([id])
    // The agent restarted: it no longer has the runner.
    const next = await poll([])
    expect(await storedRunner(id)).toMatchObject({ state: 'released' })
    expect((await storedRunner(id)).cleanupAt).not.toBeNull()
    expect(next.start).toHaveLength(1)
  })

  test('cancels runners the plane gave up on', async () => {
    await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    await expireLease(id)
    await reaper().expireLeases()
    expect((await poll([id, 'unknown'])).cancel).toEqual([id, 'unknown'])
  })

  test('releases a runner the forge failed to register', async () => {
    createRunner.mockImplementation(async () => {
      throw new Error('GitHub is down')
    })
    await queue()
    expect((await poll()).start).toHaveLength(0)
    const [failed] = await db
      .select()
      .from(runner)
      .where(eq(runner.agentId, mac.id))
    expect(failed?.state).toBe('released')
    expect(failed?.cleanupAt).not.toBeNull()
  })

  test('cleans up a registration that outlived its claim', async () => {
    let finish = () => {}
    createRunner.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ externalRunnerId: '77', config: 'late' })
        }),
    )
    await queue()
    const polled = poll()
    await sleep(50)
    const [claimed] = await db
      .select()
      .from(runner)
      .where(eq(runner.agentId, mac.id))
    await expireLease(claimed?.id ?? '')
    await reaper().expireLeases()
    finish()
    expect((await polled).start).toHaveLength(0)
    expect(await storedRunner(claimed?.id ?? '')).toMatchObject({
      state: 'released',
      externalRunnerId: '77',
    })
  })
})

describe('exited', () => {
  test('frees the agent’s slot', async () => {
    await queue()
    await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    await service().exited(mac.id, id, 0)
    expect(await storedRunner(id)).toMatchObject({
      state: 'exited',
      exitCode: 0,
    })
    expect((await poll([])).start).toHaveLength(1)
  })

  test('is scoped to the agent’s runners', async () => {
    await queue()
    const [started] = (await poll()).start
    const other = await createAgent(app.organizationId)
    await expect(
      service().exited(other.id, started?.id ?? '', 0),
    ).rejects.toThrow()
  })
})

describe('jobs picked up', () => {
  test('mark the runner running', async () => {
    const externalId = await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    const { externalRunnerId } = await storedRunner(id)
    await record({
      externalId,
      status: 'in_progress',
      externalRunnerId,
      runnerName: started?.name,
    })
    expect(await storedRunner(id)).toMatchObject({
      state: 'running',
      jobId: (await storedJob(externalId)).id,
      reservedJobId: null,
    })
  })

  test('by a runner reserved for another job free that job', async () => {
    const first = await queue()
    const [started] = (await poll()).start
    const { externalRunnerId } = await storedRunner(started?.id ?? '')
    const second = await queue()
    // GitHub hands the runner the second job instead.
    await record({
      externalId: second,
      status: 'in_progress',
      externalRunnerId,
    })
    await db.update(agent).set({ slots: 2 }).where(eq(agent.id, mac.id))

    const next = await poll([started?.id ?? ''])
    expect(next.start).toHaveLength(1)
    const replacement = await storedRunner(next.start[0]?.id ?? '')
    expect(replacement.reservedJobId).toBe((await storedJob(first)).id)
  })

  test('ignore runners of other repositories', async () => {
    const externalId = await queue()
    const [started] = (await poll()).start
    const { externalRunnerId } = await storedRunner(started?.id ?? '')
    await record({
      externalId,
      status: 'in_progress',
      externalRunnerId,
      repository: 'acme/other',
    })
    expect((await storedRunner(started?.id ?? '')).state).toBe('issued')
  })
})

describe('reaper', () => {
  test('releases runners of silent agents, and loses running ones', async () => {
    await db.update(agent).set({ slots: 2 }).where(eq(agent.id, mac.id))
    const running = await queue()
    await queue()
    const [a, b] = (await poll()).start
    const { externalRunnerId } = await storedRunner(a?.id ?? '')
    await record({
      externalId: running,
      status: 'in_progress',
      externalRunnerId,
    })
    await expireLease(a?.id ?? '')
    await expireLease(b?.id ?? '')

    await reaper().expireLeases()
    expect((await storedRunner(a?.id ?? '')).state).toBe('lost')
    expect((await storedRunner(b?.id ?? '')).state).toBe('released')

    // The agent was only out of touch: its running runner comes back.
    await poll([a?.id ?? ''], { accepting: false })
    expect(await storedRunner(a?.id ?? '')).toMatchObject({
      state: 'running',
      cleanupAt: null,
    })
  })

  test('retires runners whose job was cancelled', async () => {
    const externalId = await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    await record({ externalId, status: 'completed', conclusion: 'cancelled' })
    await db
      .update(job)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(job.forgeAppId, app.id))

    await reaper().retireIdle()
    expect(deleteRunner).toHaveBeenCalledTimes(1)
    expect((await storedRunner(id)).state).toBe('released')
    expect((await poll([id])).cancel).toEqual([id])
  })

  test('leaves a retiring runner that picked up a job', async () => {
    deleteRunner.mockImplementation(async () => 'busy')
    const externalId = await queue()
    const [started] = (await poll()).start
    await record({ externalId, status: 'completed', conclusion: 'cancelled' })
    await db
      .update(job)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(job.forgeAppId, app.id))
    await reaper().retireIdle()
    expect((await storedRunner(started?.id ?? '')).state).toBe('issued')
  })

  test('unregisters runners, looking up unknown ones by name', async () => {
    createRunner.mockImplementation(async () => {
      throw new Error('timeout')
    })
    findRunner.mockImplementation(async () => '55')
    // Other tests' runners share the database: only this one is due.
    await db.update(runner).set({ cleanupAt: null })
    await queue()
    await poll()
    await reaper().cleanup()
    expect(findRunner).toHaveBeenCalledTimes(1)
    expect(deleteRunner.mock.calls[0]?.[0].externalRunnerId).toBe('55')
    const [cleaned] = await db
      .select()
      .from(runner)
      .where(eq(runner.agentId, mac.id))
    expect(cleaned?.cleanupAt).toBeNull()
  })

  test('backs off unregistering a busy runner', async () => {
    deleteRunner.mockImplementation(async () => 'busy')
    await queue()
    const [started] = (await poll()).start
    const id = started?.id ?? ''
    await db.update(runner).set({ cleanupAt: null })
    await service().exited(mac.id, id, 1)
    await reaper().cleanup()
    const retried = await storedRunner(id)
    expect(retried.cleanupAttempts).toBe(1)
    expect(retried.cleanupAt?.getTime()).toBeGreaterThan(Date.now())
  })
})

test('an agent with runners can’t be deleted', async () => {
  await queue()
  await poll()
  expect(await agentsService.delete(app.organizationId, mac.id)).toBeInstanceOf(
    AgentBusyError,
  )
})

test('agents list how many slots they use, jobs which agent ran them', async () => {
  const externalId = await queue()
  const [started] = (await poll()).start
  const [listed] = (await agentsService.list(app.organizationId)).items.filter(
    ({ id }) => id === mac.id,
  )
  expect(listed).toMatchObject({ running: 1, slots: 1 })

  const { externalRunnerId } = await storedRunner(started?.id ?? '')
  await record({ externalId, status: 'in_progress', externalRunnerId })
  const {
    items: [ran],
  } = await jobsService.list(app.organizationId)
  expect(ran?.agentName).toBe('studio')
})
