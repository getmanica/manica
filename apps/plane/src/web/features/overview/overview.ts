import type { Treaty } from '@elysia/eden'
import type { OverviewRange } from '@shared/job-ranges'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export type Overview = Treaty.Data<(typeof api)['overview']['get']>
export type OverviewAgent = Overview['agents'][number]

// Agents and jobs move on their own: the overview follows along.
const REFRESH_MS = 10_000

// The active organization's overview of `range`, bucketed in the browser's
// time zone. A new range keeps showing the previous one until it arrives.
export const overviewQuery = (
  organizationId: string | undefined,
  range: OverviewRange,
) =>
  queryOptions({
    queryKey: ['overview', organizationId, range],
    queryFn: ({ signal }) => {
      const utcOffset = -new Date().getTimezoneOffset()
      return api.overview
        .get({ query: { range, utcOffset }, fetch: { signal } })
        .then(unwrap)
    },
    enabled: organizationId !== undefined,
    // Never another organization's: keys put its id second.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === organizationId ? previous : undefined,
    refetchInterval: REFRESH_MS,
  })

// e.g. "45s", "4m 32s", "1h 05m".
export const formatDuration = (seconds: number) => {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

// The change from `previous` to `current`, as a fraction, if both are known
// and there's something to compare with.
export const change = (current: number | null, previous: number | null) =>
  current === null || previous === null || previous === 0
    ? null
    : (current - previous) / previous

export type AgentStatus = 'running' | 'starting' | 'ready' | 'offline'

export const agentStatus = (agent: OverviewAgent): AgentStatus => {
  if (!agent.online) return 'offline'
  if (agent.jobs.length > 0) return 'running'
  if (agent.running > 0) return 'starting'
  return 'ready'
}

// Busiest first, offline last.
const statusOrder: Record<AgentStatus, number> = {
  running: 0,
  starting: 1,
  ready: 2,
  offline: 3,
}

export const byActivity = (a: OverviewAgent, b: OverviewAgent) =>
  statusOrder[agentStatus(a)] - statusOrder[agentStatus(b)] ||
  a.name.localeCompare(b.name)
