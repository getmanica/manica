import { overviewRanges } from '@shared/job-ranges'
import { BoxIcon, ClockIcon, HourglassIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Page } from '@/components/layout'
import { previousRangeLabel, RangePicker } from '@/components/range-picker'
import { AgentsGlance } from '@/features/overview/agents-glance'
import { JobRunsChart } from '@/features/overview/job-runs-chart'
import {
  change,
  formatDuration,
  type Overview as OverviewData,
} from '@/features/overview/overview'
import { Change, StatCard } from '@/features/overview/stat-card'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'
import { useEnumParam } from '@/lib/search-params'

// Agents and jobs move on their own: the overview follows along.
const REFRESH_MS = 10_000

const Stats = ({ overview }: { overview: OverviewData }) => {
  const { current, previous, agents, range } = overview
  const since = previousRangeLabel(range)
  const online = agents.filter((agent) => agent.online).length
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={BoxIcon}
        label="Agents"
        value={agents.length}
        href="/agents"
        detail={
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`size-2 rounded-full ${online > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
            />
            <span className="text-foreground">{online} online</span>
            {' · '}
            {agents.length - online} offline
          </span>
        }
      />
      <StatCard
        icon={PlayIcon}
        label="Jobs"
        value={current.jobs}
        href={`/jobs?range=${range}`}
        detail={
          <Change value={change(current.jobs, previous.jobs)} since={since} />
        }
      />
      <StatCard
        icon={ClockIcon}
        label="Avg. run time"
        value={current.runTime === null ? '—' : formatDuration(current.runTime)}
        href={`/jobs?range=${range}`}
        detail={
          <Change
            value={change(current.runTime, previous.runTime)}
            lowerIsBetter
            since={since}
          />
        }
      />
      <StatCard
        icon={HourglassIcon}
        label="Avg. queue wait"
        value={
          current.queueWait === null ? '—' : formatDuration(current.queueWait)
        }
        href={`/jobs?range=${range}`}
        detail={
          <Change
            value={change(current.queueWait, previous.queueWait)}
            lowerIsBetter
            since={since}
          />
        }
      />
    </div>
  )
}

const OverviewContent = ({ range }: { range: OverviewData['range'] }) => {
  const [overview, setOverview] = useState<OverviewData | null>(null)

  const refresh = useCallback(() => {
    const utcOffset = -new Date().getTimezoneOffset()
    void api.overview.get({ query: { range, utcOffset } }).then(({ data }) => {
      if (data) setOverview(data)
    })
  }, [range])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  if (!overview) return null
  return (
    <>
      <Stats overview={overview} />
      <JobRunsChart overview={overview} />
      <AgentsGlance agents={overview.agents} />
    </>
  )
}

export const Overview = () => {
  const { data: session } = authClient.useSession()
  const { data: organization, isPending } = authClient.useActiveOrganization()
  const [range, setRange] = useEnumParam('range', overviewRanges, '24h')
  const name = session?.user.name.split(' ')[0]

  return (
    <Page
      wide
      title="Overview"
      eyebrow="Overview"
      heading={name ? `Welcome back, ${name}.` : 'Welcome back.'}
      description="Here's what's happening with your agents and CI jobs."
      actions={
        organization && (
          <RangePicker
            ranges={overviewRanges}
            value={range}
            onChange={setRange}
          />
        )
      }
    >
      {isPending ? null : organization ? (
        <OverviewContent key={organization.id} range={range} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to see its overview.
        </p>
      )}
    </Page>
  )
}
