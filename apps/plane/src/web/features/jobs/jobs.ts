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
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'bad'
  return 'neutral'
}
