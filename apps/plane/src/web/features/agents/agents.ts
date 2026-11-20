import type { Treaty } from '@elysia/eden'
import type { MetricRange } from '@shared/metric-ranges'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export {
  builtInLabels,
  isValidLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_LENGTH,
} from '@shared/labels'

export {
  archLabels,
  formatPlatform,
  osLabels,
  parsePlatformKey,
} from '@shared/platform'

export type AgentList = Treaty.Data<(typeof api)['agents']['get']>
export type Agent = AgentList['items'][number]
export type AgentListQuery = NonNullable<
  Parameters<(typeof api)['agents']['get']>[0]
>['query']

// Every list of the active organization's agents, to refresh them all after
// a change. The API reads the organization from the session; it's in the key
// so each one keeps its own cache.
export const agentsKey = (organizationId: string | undefined) => [
  'agents',
  organizationId,
]

// Agents check in and report metrics on their own: the list follows along.
const REFRESH_MS = 30_000

// A page of the active organization's agents. Another page, sort or filter
// keeps showing the previous one's agents until its own arrive.
export const agentsQuery = (
  organizationId: string | undefined,
  query: AgentListQuery,
) =>
  queryOptions({
    queryKey: [...agentsKey(organizationId), query],
    queryFn: ({ signal }) =>
      api.agents.get({ query, fetch: { signal } }).then(unwrap),
    enabled: organizationId !== undefined,
    // Never another organization's: keys put its id second.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === organizationId ? previous : undefined,
    refetchInterval: REFRESH_MS,
  })

export type AgentMetrics = Treaty.Data<
  ReturnType<(typeof api)['agents']>['metrics']['get']
>
export type AgentMetricsPoint = AgentMetrics['points'][number]

// Agents report a reading every 30 seconds by default: the chart follows.
const METRICS_REFRESH_MS = 30_000

// One of the active organization's agents' metrics over `range`, its points
// starting on the browser's clock. A new range keeps showing the previous one
// until it arrives.
export const agentMetricsQuery = (
  organizationId: string | undefined,
  agentId: string | undefined,
  range: MetricRange,
) =>
  queryOptions({
    queryKey: [...agentsKey(organizationId), 'metrics', agentId, range],
    queryFn: ({ signal }) => {
      const utcOffset = -new Date().getTimezoneOffset()
      return api
        .agents({ id: agentId ?? '' })
        .metrics.get({ query: { range, utcOffset }, fetch: { signal } })
        .then(unwrap)
    },
    enabled: organizationId !== undefined && agentId !== undefined,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === organizationId && query?.queryKey[3] === agentId
        ? previous
        : undefined,
    refetchInterval: METRICS_REFRESH_MS,
  })
