import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type AgentStatus,
  agentStatus,
  byActivity,
  formatDuration,
  type OverviewAgent,
} from '@/features/overview/overview'

const SHOWN = 5

const statuses: Record<
  AgentStatus,
  { label: string; dot: string; text: string }
> = {
  running: {
    label: 'Running',
    dot: 'bg-emerald-500',
    text: 'text-blue-600 dark:text-blue-400',
  },
  starting: {
    label: 'Starting',
    dot: 'bg-emerald-500',
    text: 'text-blue-600 dark:text-blue-400',
  },
  ready: {
    label: 'Ready',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-muted-foreground/50',
    text: 'text-muted-foreground',
  },
}

// Re-renders every second, for running times.
const useNow = () => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const CurrentJob = ({ agent, now }: { agent: OverviewAgent; now: number }) => {
  const [job, ...more] = agent.jobs
  if (!job) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <a
        href={job.url}
        target="_blank"
        rel="noreferrer"
        className="truncate hover:underline"
      >
        {job.name}
        <span className="text-muted-foreground"> · {job.repository}</span>
      </a>
      {more.length > 0 && (
        <span className="shrink-0 text-muted-foreground text-xs">
          +{more.length} more
        </span>
      )}
      {job.startedAt && (
        <span className="ml-auto shrink-0 pl-4 text-muted-foreground tabular-nums">
          {formatDuration((now - new Date(job.startedAt).getTime()) / 1000)}
        </span>
      )}
    </span>
  )
}

const Section = ({ children }: { children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <h2 className="font-semibold text-lg">Agents</h2>
      <Link
        to="/agents"
        className="inline-flex items-center gap-1 font-medium text-sm hover:underline"
      >
        View all
        <ChevronRightIcon className="size-4" />
      </Link>
    </div>
    {children}
  </section>
)

const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border">
    <table className="w-full text-sm">
      <thead className="bg-muted/40 text-left text-muted-foreground">
        <tr>
          <th className="h-10 px-4 font-medium">Name</th>
          <th className="h-10 px-4 font-medium">Status</th>
          <th className="h-10 w-1/2 px-4 font-medium">Current job</th>
          <th className="h-10 w-10 px-4">
            <span className="sr-only">Open</span>
          </th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
)

// The table's place while the agents load.
export const AgentsGlanceSkeleton = () => (
  <Section>
    <Table>
      {[0, 1, 2].map((row) => (
        <tr key={row} className="border-t">
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-16" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-2/3" />
          </td>
          <td className="px-4 py-3" />
        </tr>
      ))}
    </Table>
  </Section>
)

// The busiest agents, and what they're running right now.
export const AgentsGlance = ({ agents }: { agents: OverviewAgent[] }) => {
  const now = useNow()
  const shown = [...agents].sort(byActivity).slice(0, SHOWN)

  return (
    <Section>
      {agents.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
          No agents yet.{' '}
          <Link to="/agents" className="text-foreground hover:underline">
            Create one
          </Link>{' '}
          to start running CI jobs.
        </p>
      ) : (
        <Table>
          {shown.map((agent) => {
            const status = statuses[agentStatus(agent)]
            return (
              <tr
                key={agent.id}
                className="border-t transition-colors hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <span className="flex items-center gap-3 font-medium">
                    <span
                      aria-hidden
                      className={`size-2 shrink-0 rounded-full ${status.dot}`}
                    />
                    {agent.name}
                  </span>
                </td>
                <td className={`px-4 py-3 ${status.text}`}>
                  {status.label}
                  {agent.running > 1 && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {agent.running}/{agent.slots}
                    </span>
                  )}
                </td>
                <td className="max-w-0 px-4 py-3">
                  <CurrentJob agent={agent} now={now} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    to="/agents"
                    search={{ q: agent.name }}
                    aria-label={`Open ${agent.name}`}
                    className="flex justify-end text-muted-foreground hover:text-foreground"
                  >
                    <ChevronRightIcon className="size-4" />
                  </Link>
                </td>
              </tr>
            )
          })}
        </Table>
      )}
    </Section>
  )
}
