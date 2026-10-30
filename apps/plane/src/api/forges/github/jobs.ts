import type { JobStatus } from '../../platform/db/schema'
import type { JobEvent } from '../forge'

// A job as GitHub describes it, in `workflow_job` webhooks and the REST API.
// https://docs.github.com/en/webhooks/webhook-events-and-payloads#workflow_job
export type GithubJob = {
  id: number
  run_id: number
  name: string
  html_url: string
  labels: string[]
  status: string
  runner_id: number | null
  runner_name: string | null
  conclusion: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

const date = (value: string | null) => (value ? new Date(value) : null)

export const toJobEvent = (
  job: GithubJob,
  status: JobStatus,
  {
    repository,
    installationId,
  }: { repository: string; installationId: string },
): JobEvent => ({
  type: 'job',
  status,
  externalId: String(job.id),
  runId: String(job.run_id),
  installationId,
  repository,
  name: job.name,
  url: job.html_url,
  labels: job.labels,
  externalRunnerId: job.runner_id ? String(job.runner_id) : null,
  runnerName: job.runner_name || null,
  conclusion: job.conclusion,
  queuedAt: new Date(job.created_at),
  startedAt: date(job.started_at),
  completedAt: date(job.completed_at),
})
