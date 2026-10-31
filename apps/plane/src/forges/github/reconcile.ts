import { NotFoundError } from 'forges'
import type { Forge, JobStatus } from '../forge'
import { attempt, type createClients, repoPath } from './client'
import { type GithubJob, toJobEvent } from './jobs'

// https://docs.github.com/en/rest/apps/webhooks#list-deliveries-for-an-app-webhook
type Delivery = {
  id: number
  guid: string
  delivered_at: string
  status_code: number
  event: string
}

const PAGE_SIZE = 100

// Jobs waiting on something else than a runner (an environment's approval,
// a concurrency group) haven't started: as far as runners go, they're queued.
const jobStatus = (status: string): JobStatus =>
  status === 'in_progress' || status === 'completed' ? status : 'queued'

const succeeded = (delivery: Delivery) =>
  delivery.status_code >= 200 && delivery.status_code < 300

// The cursor GitHub's Link header points the next page at, if any.
const nextCursor = (link: string | null) => {
  const next = link?.split(',').find((part) => part.includes('rel="next"'))
  const url = next?.match(/<([^>]+)>/)?.[1]
  return url
    ? (new URL(url).searchParams.get('cursor') ?? undefined)
    : undefined
}

// Catching up on what webhooks missed: GitHub doesn't retry failed
// deliveries on its own.
export const createReconcileApi = (
  clients: ReturnType<typeof createClients>,
): Pick<Forge, 'getJob' | 'redeliverFailed'> => ({
  getJob: ({ app, installationId, repository, externalId }) =>
    attempt(
      'read a job',
      async () => {
        const { data } = await clients.installation(
          app,
          installationId,
        )<GithubJob>(
          'GET',
          `${repoPath(repository)}/actions/jobs/${encodeURIComponent(externalId)}`,
        )
        return toJobEvent(data, jobStatus(data.status), {
          repository,
          installationId,
        })
      },
      (error) => (error instanceof NotFoundError ? null : undefined),
    ).then((event) => event ?? undefined),

  async redeliverFailed({ app, since }) {
    const request = clients.app(app)

    // Deliveries come newest first, one per attempt: a delivery GitHub sent
    // again has several, sharing its guid.
    const attempts = new Map<string, Delivery[]>()
    let cursor: string | undefined
    let more = true
    while (more) {
      const { data, headers } = await attempt('list webhook deliveries', () =>
        request<Delivery[]>('GET', '/app/hook/deliveries', {
          query: { per_page: PAGE_SIZE, cursor },
        }),
      )
      for (const delivery of data) {
        if (new Date(delivery.delivered_at) < since) {
          more = false
          break
        }
        attempts.set(delivery.guid, [
          ...(attempts.get(delivery.guid) ?? []),
          delivery,
        ])
      }
      cursor = nextCursor(headers.get('link'))
      if (!cursor) more = false
    }

    let redelivered = 0
    for (const [, deliveries] of attempts) {
      const [latest] = deliveries
      if (latest?.event !== 'workflow_job') continue
      if (deliveries.some(succeeded)) continue
      await attempt('redeliver a webhook', () =>
        request('POST', `/app/hook/deliveries/${latest.id}/attempts`),
      )
      redelivered++
    }
    return redelivered
  },
})
