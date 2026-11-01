import type { Treaty } from '@elysia/eden'
import type { api } from '@/lib/api'

export type Overview = Treaty.Data<(typeof api)['overview']['get']>
export type OverviewAgent = Overview['agents'][number]

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
