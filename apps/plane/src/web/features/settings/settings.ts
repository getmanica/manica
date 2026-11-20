import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export { metricsRetentionDays } from '@shared/organization-settings'

// The active organization's settings. The API reads the organization from
// the session; it's in the key so each one keeps its own cache.
export const settingsQuery = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: ['organization-settings', organizationId],
    queryFn: ({ signal }) =>
      api.organization.settings.get({ fetch: { signal } }).then(unwrap),
    enabled: organizationId !== undefined,
  })
