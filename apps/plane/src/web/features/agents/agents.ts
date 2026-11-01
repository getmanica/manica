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

export type Agent = Treaty.Data<(typeof api)['agents']['get']>[number]

export const osLabels: Record<Agent['os'], string> = {
  linux: 'Linux',
  darwin: 'macOS',
  windows: 'Windows',
}

export const archLabels: Record<Agent['arch'], string> = {
  arm64: 'ARM64',
  x86_64: 'x86-64',
}

// e.g. "macOS ARM64".
export const formatPlatform = ({ os, arch }: Pick<Agent, 'os' | 'arch'>) =>
  `${osLabels[os]} ${archLabels[arch]}`

// Whether an agent matches the filter box: its name, platform, labels or
// version contain the text, ignoring case.
export const agentMatches = (agent: Agent, text: string) => {
  const needle = text.trim().toLowerCase()
  if (!needle) return true
  return [
    agent.name,
    formatPlatform(agent),
    agent.version ?? '',
    ...agent.labels,
  ].some((value) => value.toLowerCase().includes(needle))
}

// The active organization's agents. The API reads the organization from the
// session; it's in the key so each one keeps its own cache.
export const agentsQuery = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: ['agents', organizationId],
    queryFn: ({ signal }) => api.agents.get({ fetch: { signal } }).then(unwrap),
    enabled: organizationId !== undefined,
  })
