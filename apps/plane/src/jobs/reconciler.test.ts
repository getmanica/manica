import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createAgent, createOrganization } from '../../test/fixtures'
import { fakeForge, forgesWith } from '../../test/forge'
import { db } from '../db'
import { forgeApp, job } from '../db/schema'
import type { Forge, JobEvent } from '../forges/forge'
import { jobsService } from './jobs.service'
import { createReconciler } from './reconciler'

const MINUTE = 60 * 1000

let app: typeof forgeApp.$inferSelect

beforeEach(async () => {
  // Apps from other tests share the database: start from this one alone.
  await db.delete(forgeApp)
  const created = await createOrganization()
  app = created.app
  await createAgent(created.organizationId)
})

const queued: JobEvent = {
  type: 'job',
  status: 'queued',
  externalId: '1',
  runId: '10',
  installationId: '7',
  repository: 'acme/widgets',
  name: 'build',
  url: 'https://github.com/acme/widgets/actions/runs/10/job/1',
  labels: ['self-hosted'],
  externalRunnerId: null,
  runnerName: null,
  conclusion: null,
  queuedAt: new Date('2026-10-31T10:00:00Z'),
  startedAt: null,
  completedAt: null,
}

const reconcilerWith = (forge: Partial<Forge>) =>
  createReconciler(forgesWith(fakeForge(forge)))

describe('redeliverFailed', () => {
  test('looks back an hour the first time, then since the last check', async () => {
    const redeliverFailed = mock(
      async (_: Parameters<Forge['redeliverFailed']>[0]) => 0,
    )
    const reconciler = reconcilerWith({ redeliverFailed })
    const first = new Date('2026-10-31T12:00:00Z')
    const second = new Date('2026-10-31T12:05:00Z')

    await reconciler.redeliverFailed(first)
    await reconciler.redeliverFailed(second)

    expect(redeliverFailed.mock.calls.map(([{ since }]) => since)).toEqual([
      new Date('2026-10-31T11:00:00Z'),
      // Overlapping the previous check by 5 minutes.
      new Date('2026-10-31T11:55:00Z'),
    ])
    expect(redeliverFailed.mock.calls[0]?.[0]?.app.secrets).toEqual({
      privateKey: 'test',
    })
  })

  test('keeps the last check when the forge fails, to retry from it', async () => {
    const reconciler = reconcilerWith({
      redeliverFailed: async () => {
        throw new Error('GitHub is down')
      },
    })
    await reconciler.redeliverFailed()
    const [stored] = await db
      .select()
      .from(forgeApp)
      .where(eq(forgeApp.id, app.id))
    expect(stored?.deliveriesCheckedAt).toBeNull()
  })
})

describe('resyncStale', () => {
  // As if the plane last heard about the job `minutes` ago.
  const lastHeard = (minutes: number) =>
    db
      .update(job)
      .set({ updatedAt: new Date(Date.now() - minutes * MINUTE) })
      .where(eq(job.forgeAppId, app.id))

  const stored = async () => {
    const [found] = await db
      .select()
      .from(job)
      .where(eq(job.forgeAppId, app.id))
    return found
  }

  beforeEach(() => jobsService.record(app, queued))

  test('leaves jobs heard of recently alone', async () => {
    const getJob = mock(async () => undefined)
    await lastHeard(5)
    await reconcilerWith({ getJob }).resyncStale()
    expect(getJob).not.toHaveBeenCalled()
  })

  test('takes the forge’s word for stale jobs', async () => {
    const reconciler = reconcilerWith({
      getJob: async () => ({
        ...queued,
        status: 'completed',
        conclusion: 'cancelled',
      }),
    })
    await lastHeard(11)
    await reconciler.resyncStale()
    expect(await stored()).toMatchObject({
      status: 'completed',
      conclusion: 'cancelled',
    })
  })

  test('completes a job the forge no longer has', async () => {
    await lastHeard(11)
    await reconcilerWith({ getJob: async () => undefined }).resyncStale()
    expect((await stored())?.status).toBe('completed')
  })

  test('waits again before rechecking a job that hasn’t changed', async () => {
    const getJob = mock(async () => queued)
    const reconciler = reconcilerWith({ getJob })
    await lastHeard(11)
    await reconciler.resyncStale()
    await reconciler.resyncStale()
    expect(getJob).toHaveBeenCalledTimes(1)
  })
})
