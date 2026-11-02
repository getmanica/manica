import type { Treaty } from '@elysia/eden'
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
  })
