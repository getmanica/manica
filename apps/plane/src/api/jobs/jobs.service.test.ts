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

describe('list', () => {
  const listed = async (options?: Parameters<typeof jobsService.list>[1]) =>
    (await jobsService.list(app.organizationId, options)).items.map(
      ({ name }) => name,
    )

  // build (queued 10:00, queued), test (11:00, running), lint (12:00,
  // failed), deploy (13:00, succeeded).
  const recordFour = async () => {
    await jobsService.record(app, event())
    await jobsService.record(
      app,
      event({
        externalId: '2',
        name: 'test',
        queuedAt: new Date('2026-10-31T11:00:00Z'),
        ...started,
      }),
    )
    await jobsService.record(
      app,
      event({
        externalId: '3',
        name: 'lint',
        repository: 'acme/gadgets',
        queuedAt: new Date('2026-10-31T12:00:00Z'),
        ...started,
        ...completed,
        conclusion: 'timed_out',
      }),
    )
    await jobsService.record(
      app,
      event({
        externalId: '4',
        name: 'deploy',
        queuedAt: new Date('2026-10-31T13:00:00Z'),
        ...started,
        ...completed,
      }),
    )
  }

  test('is scoped to the organization', async () => {
    await jobsService.record(app, event())
    const other = await createOrganization()
    expect(await jobsService.list(app.organizationId)).toMatchObject({
      total: 1,
    })
    expect(await jobsService.list(other.organizationId)).toEqual({
      items: [],
      total: 0,
      outcomes: [],
    })
  })

  test('only includes jobs queued since the given time', async () => {
    await recordFour()
    const since = new Date('2026-10-31T11:30:00Z')
    expect(await listed({ since })).toEqual(['deploy', 'lint'])
    expect(await listed()).toHaveLength(4)
  })

  test('pages through the latest jobs first', async () => {
    for (let hour = 0; hour < 12; hour++) {
      await jobsService.record(
        app,
        event({
          externalId: `${hour}`,
          name: `job-${hour}`,
          queuedAt: new Date(Date.UTC(2026, 9, 31, hour)),
        }),
      )
    }
    const first = await jobsService.list(app.organizationId, { size: 10 })
    expect(first.total).toBe(12)
    expect(first.items).toHaveLength(10)
    expect(first.items[0]?.name).toBe('job-11')
    expect(await listed({ size: 10, page: 2 })).toEqual(['job-1', 'job-0'])
    expect(await listed({ size: 10, page: 3 })).toEqual([])
  })

  test('sorts by a column either way', async () => {
    await recordFour()
    expect(await listed({ sort: 'name', dir: 'asc' })).toEqual([
      'build',
      'deploy',
      'lint',
      'test',
    ])
    expect(await listed({ sort: 'outcome', dir: 'desc' })).toEqual([
      'lint',
      'deploy',
      'test',
      'build',
    ])
  })

  test('filters by outcome, and lists the outcomes there are', async () => {
    await recordFour()
    expect(await listed({ outcomes: ['queued', 'timed_out'] })).toEqual([
      'lint',
      'build',
    ])
    const { outcomes } = await jobsService.list(app.organizationId, {
      outcomes: ['queued'],
    })
    expect(outcomes).toEqual(['in_progress', 'queued', 'success', 'timed_out'])
  })

  test('filters by text, as the console shows the job', async () => {
    await recordFour()
    expect(await listed({ q: 'GADGETS' })).toEqual(['lint'])
    expect(await listed({ q: 'running' })).toEqual(['test'])
    expect(await listed({ q: 'timed out' })).toEqual(['lint'])
    expect(await listed({ q: 'macos' })).toHaveLength(4)
    expect(await listed({ q: '%' })).toEqual([])
  })
})
