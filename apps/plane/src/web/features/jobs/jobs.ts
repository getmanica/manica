import type { Treaty } from '@elysia/eden'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export type JobList = Treaty.Data<(typeof api)['jobs']['get']>
export type Job = JobList['items'][number]
export type JobListQuery = NonNullable<
  Parameters<(typeof api)['jobs']['get']>[0]
>['query']

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

// Jobs move on their own: the list follows along.
const REFRESH_MS = 5000

// A page of the active organization's jobs. Another page, sort or filter
// keeps showing the previous one's jobs until its own arrive.
export const jobsQuery = (
  organizationId: string | undefined,
  query: JobListQuery,
) =>
  queryOptions({
    queryKey: ['jobs', organizationId, query],
    queryFn: ({ signal }) =>
      api.jobs.get({ query, fetch: { signal } }).then(unwrap),
    enabled: organizationId !== undefined,
    // Never another organization's: keys put its id second.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === organizationId ? previous : undefined,
    refetchInterval: REFRESH_MS,
  })
