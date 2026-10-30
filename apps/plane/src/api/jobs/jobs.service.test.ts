import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createAgent, createOrganization } from '../../../test/fixtures'
import type { JobEvent } from '../forges/forge'
import { db } from '../platform/db'
import { job } from '../platform/db/schema'
import { jobsService } from './jobs.service'

let app: { id: string; organizationId: string }

beforeEach(async () => {
  const created = await createOrganization()
  app = { id: created.app.id, organizationId: created.organizationId }
  await createAgent(app.organizationId, { name: 'studio', labels: ['gpu'] })
})

const event = (overrides: Partial<JobEvent> = {}): JobEvent => ({
  type: 'job',
  status: 'queued',
  externalId: '1',
  runId: '10',
  installationId: '7',
  repository: 'acme/widgets',
  name: 'build',
  url: 'https://github.com/acme/widgets/actions/runs/10/job/1',
  labels: ['self-hosted', 'macOS', 'GPU'],
  externalRunnerId: null,
  runnerName: null,
  conclusion: null,
  queuedAt: new Date('2026-10-31T10:00:00Z'),
  startedAt: null,
  completedAt: null,
  ...overrides,
})

const started = {
  status: 'in_progress',
  externalRunnerId: '99',
  runnerName: 'manica-1',
  startedAt: new Date('2026-10-31T10:01:00Z'),
} as const

const completed = {
  status: 'completed',
  conclusion: 'success',
  completedAt: new Date('2026-10-31T10:05:00Z'),
} as const

const stored = () => db.select().from(job).where(eq(job.forgeAppId, app.id))

describe('record', () => {
  test('queues a job an agent can run, with labels lowercased', async () => {
    await jobsService.record(app, event())
    const [queued] = await stored()
    expect(queued).toMatchObject({
      status: 'queued',
      organizationId: app.organizationId,
      labels: ['self-hosted', 'macos', 'gpu'],
      queuedAt: new Date('2026-10-31T10:00:00Z'),
    })
  })

  test('ignores a job no agent can run', async () => {
    await jobsService.record(app, event({ labels: ['ubuntu-latest'] }))
    expect(await stored()).toHaveLength(0)
  })

  test('follows a job through to completion', async () => {
    await jobsService.record(app, event())
    await jobsService.record(app, event(started))
    await jobsService.record(app, event({ ...started, ...completed }))
    const [done] = await stored()
    expect(done).toMatchObject({
      status: 'completed',
      conclusion: 'success',
      runnerName: 'manica-1',
      startedAt: started.startedAt,
      completedAt: completed.completedAt,
    })
  })

  test('never moves a job backwards', async () => {
    await jobsService.record(app, event({ ...started, ...completed }))
    await jobsService.record(app, event(started))
    await jobsService.record(app, event())
    const [done] = await stored()
    expect(done).toMatchObject({ status: 'completed', conclusion: 'success' })
  })

  test('keeps what earlier events knew', async () => {
    await jobsService.record(app, event(started))
    // A completed delivery for a job cancelled before it started carries no
    // runner: the one already seen stays.
    await jobsService.record(
      app,
      event({ ...completed, conclusion: 'failure' }),
    )
    const [done] = await stored()
    expect(done).toMatchObject({
      status: 'completed',
      conclusion: 'failure',
      runnerName: 'manica-1',
      startedAt: started.startedAt,
    })
  })

  test('stores a job first seen completed', async () => {
    await jobsService.record(app, event(completed))
    expect(await stored()).toHaveLength(1)
  })

  test('keeps updating a stored job its agents can no longer run', async () => {
    await jobsService.record(app, event())
    await jobsService.record(
      app,
      event({ ...completed, labels: ['self-hosted', 'linux'] }),
    )
    const [done] = await stored()
    expect(done?.status).toBe('completed')
  })
})

test('list is scoped to the organization', async () => {
  await jobsService.record(app, event())
  const other = await createOrganization()
  expect(await jobsService.list(app.organizationId)).toHaveLength(1)
  expect(await jobsService.list(other.organizationId)).toHaveLength(0)
})
