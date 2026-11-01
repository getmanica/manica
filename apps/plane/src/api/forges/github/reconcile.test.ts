import { describe, expect, test } from 'bun:test'
import { fakeGithub, scope } from '../../../../test/github'
import { createClients } from './client'
import { createReconcileApi } from './reconcile'

const githubJob = {
  id: 1,
  run_id: 10,
  name: 'build',
  html_url: 'https://github.com/acme/widgets/actions/runs/10/job/1',
  labels: ['self-hosted'],
  status: 'in_progress',
  runner_id: 99,
  runner_name: 'manica-1',
  conclusion: null,
  created_at: '2026-10-31T10:00:00Z',
  started_at: '2026-10-31T10:01:00Z',
  completed_at: null,
}

const api = (routes: Parameters<typeof fakeGithub>[0]) => {
  const github = fakeGithub(routes)
  return { github, api: createReconcileApi(createClients(github.fetch)) }
}

describe('getJob', () => {
  const job = '/repos/acme/widgets/actions/jobs/1'
  const input = { ...scope, externalId: '1' }

  test('reads the job', async () => {
    const { api: reconcile } = api({
      [`GET ${job}`]: { status: 200, body: githubJob },
    })
    expect(await reconcile.getJob(input)).toMatchObject({
      status: 'in_progress',
      externalRunnerId: '99',
      installationId: '7',
      repository: 'acme/widgets',
    })
  })

  test('counts a job waiting on something else as queued', async () => {
    const { api: reconcile } = api({
      [`GET ${job}`]: {
        status: 200,
        body: { ...githubJob, status: 'waiting' },
      },
    })
    expect((await reconcile.getJob(input))?.status).toBe('queued')
  })

  test('is undefined for a job that’s gone', async () => {
    const { api: reconcile } = api({
      [`GET ${job}`]: { status: 404, body: { message: 'Not Found' } },
    })
    expect(await reconcile.getJob(input)).toBeUndefined()
  })
})

describe('redeliverFailed', () => {
  const delivery = (
    id: number,
    guid: string,
    status_code: number,
    delivered_at = '2026-10-31T10:00:00Z',
    event = 'workflow_job',
  ) => ({ id, guid, status_code, delivered_at, event })

  const redeliveries = (calls: { method: string; path: string }[]) =>
    calls.filter((call) => call.method === 'POST').map((call) => call.path)

  test('resends the job deliveries no attempt of which succeeded', async () => {
    const { github, api: reconcile } = api({
      'GET /app/hook/deliveries': {
        status: 200,
        body: [
          // Failed, then resent successfully.
          delivery(4, 'a', 200),
          delivery(3, 'a', 502),
          // Failed twice.
          delivery(2, 'b', 502),
          delivery(1, 'b', 0),
          // Not about jobs.
          delivery(0, 'c', 502, undefined, 'installation'),
        ],
      },
      'POST /app/hook/deliveries/2/attempts': { status: 202 },
    })
    const count = await reconcile.redeliverFailed({
      app: scope.app,
      since: new Date('2026-10-31T09:00:00Z'),
    })
    expect(count).toBe(1)
    expect(redeliveries(github.calls)).toEqual([
      '/app/hook/deliveries/2/attempts',
    ])
  })

  test('follows pages until deliveries predate `since`', async () => {
    const { github, api: reconcile } = api({
      'GET /app/hook/deliveries?per_page=100': {
        status: 200,
        body: [delivery(3, 'a', 502)],
        headers: {
          link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=next>; rel="next"',
        },
      },
      'GET /app/hook/deliveries?per_page=100&cursor=next': {
        status: 200,
        body: [
          delivery(2, 'b', 502),
          delivery(1, 'c', 502, '2026-10-31T08:00:00Z'),
        ],
        headers: {
          link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=last>; rel="next"',
        },
      },
      'POST /app/hook/deliveries/3/attempts': { status: 202 },
      'POST /app/hook/deliveries/2/attempts': { status: 202 },
    })
    await reconcile.redeliverFailed({
      app: scope.app,
      since: new Date('2026-10-31T09:00:00Z'),
    })
    expect(redeliveries(github.calls)).toEqual([
      '/app/hook/deliveries/3/attempts',
      '/app/hook/deliveries/2/attempts',
    ])
    expect(github.calls.some((call) => call.search.includes('last'))).toBe(
      false,
    )
  })
})
