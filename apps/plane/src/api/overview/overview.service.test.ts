import { beforeEach, describe, expect, test } from 'bun:test'
import { createAgent, createOrganization } from '../../../test/fixtures'
import { db } from '../platform/db'
import { job, runner } from '../platform/db/schema'
import { firstBucket, overviewService } from './overview.service'

const now = new Date('2026-10-31T12:30:00Z')
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60 * 1000)

let org: { organizationId: string; app: { id: string } }

beforeEach(async () => {
  org = await createOrganization()
})

let externalId = 0
const insertJob = async (values: Partial<typeof job.$inferInsert> = {}) => {
  const [inserted] = await db
    .insert(job)
    .values({
      id: crypto.randomUUID(),
      organizationId: org.organizationId,
      forgeAppId: org.app.id,
      externalId: String(++externalId),
      runId: '1',
      installationId: '1',
      repository: 'acme/widgets',
      name: 'build',
      url: 'https://github.com/acme/widgets/actions/runs/1/job/1',
      labels: ['self-hosted'],
      status: 'completed',
      conclusion: 'success',
      queuedAt: hoursAgo(1),
      ...values,
    })
    .returning()
  if (!inserted) throw new Error('No job inserted')
  return inserted
}

const get = () =>
  overviewService.get(org.organizationId, '24h', { now, utcOffset: 0 })

describe('firstBucket', () => {
  test('ends with the bar now falls in', () => {
    expect(firstBucket(now, 60 * 60 * 1000, 24, 0)).toEqual(
      new Date('2026-10-30T13:00:00Z'),
    )
  })

  test("starts day bars at the viewer's midnight", () => {
    const day = 24 * 60 * 60 * 1000
    // 12:30 UTC is 14:30 two hours ahead: that day starts at 22:00 UTC.
    expect(firstBucket(now, day, 1, 120)).toEqual(
      new Date('2026-10-30T22:00:00Z'),
    )
  })
})

describe('stats', () => {
  test('compares the range with the one before it', async () => {
    await insertJob({
      queuedAt: hoursAgo(2),
      startedAt: new Date(hoursAgo(2).getTime() + 30_000),
      completedAt: new Date(hoursAgo(2).getTime() + 150_000),
    })
    await insertJob({
      queuedAt: hoursAgo(3),
      status: 'queued',
      conclusion: null,
    })
    await insertJob({
      queuedAt: hoursAgo(30),
      startedAt: new Date(hoursAgo(30).getTime() + 10_000),
      completedAt: new Date(hoursAgo(30).getTime() + 70_000),
    })
    await insertJob({ queuedAt: hoursAgo(50) })

    const { current, previous } = await get()
    expect(current).toEqual({ jobs: 2, runTime: 120, queueWait: 30 })
    expect(previous).toEqual({ jobs: 1, runTime: 60, queueWait: 10 })
  })

  test('leaves skipped jobs out of the run time', async () => {
    await insertJob({
      conclusion: 'skipped',
      startedAt: hoursAgo(1),
      completedAt: hoursAgo(0.5),
    })
    expect((await get()).current.runTime).toBeNull()
  })
})

describe('buckets', () => {
  test('counts finished jobs per bar, by how they ended', async () => {
    await insertJob({ queuedAt: new Date('2026-10-31T11:10:00Z') })
    await insertJob({
      queuedAt: new Date('2026-10-31T11:50:00Z'),
      conclusion: 'timed_out',
    })
    await insertJob({
      queuedAt: new Date('2026-10-31T12:05:00Z'),
      conclusion: 'cancelled',
    })
    await insertJob({
      queuedAt: new Date('2026-10-31T12:06:00Z'),
      conclusion: 'skipped',
    })
    await insertJob({
      queuedAt: new Date('2026-10-31T12:07:00Z'),
      status: 'in_progress',
      conclusion: null,
    })

    const { buckets } = await get()
    expect(buckets).toHaveLength(24)
    expect(buckets.at(-2)).toEqual({
      start: new Date('2026-10-31T11:00:00Z'),
      succeeded: 1,
      failed: 1,
      cancelled: 0,
      other: 0,
    })
    expect(buckets.at(-1)).toEqual({
      start: new Date('2026-10-31T12:00:00Z'),
      succeeded: 0,
      failed: 0,
      cancelled: 1,
      other: 1,
    })
  })
})

describe('agents', () => {
  test('tells online agents apart and lists what they run', async () => {
    const busy = await createAgent(org.organizationId, {
      name: 'busy',
      lastSeenAt: new Date(now.getTime() - 10_000),
    })
    await createAgent(org.organizationId, {
      name: 'gone',
      lastSeenAt: hoursAgo(1),
    })
    const running = await insertJob({
      status: 'in_progress',
      conclusion: null,
      startedAt: hoursAgo(0.1),
    })
    await db.insert(runner).values({
      id: crypto.randomUUID(),
      agentId: busy.id,
      forgeAppId: org.app.id,
      installationId: '1',
      repository: 'acme/widgets',
      labels: ['self-hosted'],
      state: 'running',
      jobId: running.id,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    })

    const { agents } = await get()
    expect(agents).toMatchObject([
      {
        name: 'busy',
        online: true,
        running: 1,
        jobs: [{ id: running.id, name: 'build' }],
      },
      { name: 'gone', online: false, running: 0, jobs: [] },
    ])
  })
})
