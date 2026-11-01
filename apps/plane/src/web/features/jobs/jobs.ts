import type { Treaty } from '@elysia/eden'
import type { api } from '@/lib/api'

export type Job = Treaty.Data<(typeof api)['jobs']['get']>[number]

// What a job's at: waiting, running, or how it ended (GitHub's conclusions:
// success, failure, cancelled, skipped, timed_out…).
export const jobOutcome = ({ status, conclusion }: Job) => {
  if (status === 'queued') return 'Queued'
  if (status === 'in_progress') return 'Running'
  if (!conclusion) return 'Completed'
  const text = conclusion.replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type OutcomeTone = 'pending' | 'active' | 'good' | 'bad' | 'neutral'

export const outcomeTone = ({ status, conclusion }: Job): OutcomeTone => {
  if (status === 'queued') return 'pending'
  if (status === 'in_progress') return 'active'
  if (conclusion === 'success') return 'good'
  if (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'cancelled'
  )
    return 'bad'
  return 'neutral'
}

// The outcomes the status filter always offers; any other one shows up once a
// listed job has it.
export const commonOutcomes = [
  'Queued',
  'Running',
  'Success',
  'Failure',
  'Cancelled',
  'Skipped',
  'Timed out',
]

// Whether a job matches the filter box: its name, repository, agent, labels or
// outcome contain the text, ignoring case.
export const jobMatches = (job: Job, text: string) => {
  const needle = text.trim().toLowerCase()
  if (!needle) return true
  return [
    job.name,
    job.repository,
    job.agentName ?? '',
    jobOutcome(job),
    ...job.labels,
  ].some((value) => value.toLowerCase().includes(needle))
}
