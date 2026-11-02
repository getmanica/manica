import { type OverviewRange, overviewRanges } from '@shared/job-ranges'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { BoxIcon, ClockIcon, HourglassIcon, PlayIcon } from 'lucide-react'
import { Page } from '@/components/layout'
import { LoadError, Loading } from '@/components/loading'
import { previousRangeLabel, RangePicker } from '@/components/range-picker'
import {
  AgentsGlance,
  AgentsGlanceSkeleton,
} from '@/features/overview/agents-glance'
import {
  JobRunsChart,
  JobRunsChartSkeleton,
} from '@/features/overview/job-runs-chart'
import {
  change,
  formatDuration,
  type Overview as OverviewData,
  overviewQuery,
} from '@/features/overview/overview'
import {
  Change,
  StatCard,
  StatCardSkeleton,
} from '@/features/overview/stat-card'
import { authClient } from '@/lib/auth'

const route = getRouteApi('/_signedIn/')

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
        link={{ to: '/agents' }}
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
        link={{ to: '/jobs', search: { range } }}
        detail={
          <Change value={change(current.jobs, previous.jobs)} since={since} />
        }
      />
      <StatCard
        icon={ClockIcon}
        label="Avg. run time"
        value={current.runTime === null ? '—' : formatDuration(current.runTime)}
        link={{ to: '/jobs', search: { range } }}
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
        link={{ to: '/jobs', search: { range } }}
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

const OverviewSkeleton = () => (
  <Loading label="Loading overview…" className="flex flex-col gap-8">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCardSkeleton icon={BoxIcon} label="Agents" />
      <StatCardSkeleton icon={PlayIcon} label="Jobs" />
      <StatCardSkeleton icon={ClockIcon} label="Avg. run time" />
      <StatCardSkeleton icon={HourglassIcon} label="Avg. queue wait" />
    </div>
    <JobRunsChartSkeleton />
    <AgentsGlanceSkeleton />
  </Loading>
)

const OverviewContent = ({
  organizationId,
  range,
}: {
  organizationId: string | undefined
  range: OverviewData['range']
}) => {
  const query = useQuery(overviewQuery(organizationId, range))
  const overview = query.data

  if (!overview) {
    return query.isError ? (
      <LoadError
        title="Couldn't load the overview"
        error={query.error}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    ) : (
      <OverviewSkeleton />
    )
  }
  return (
    <div
      aria-busy={query.isPlaceholderData}
      className={`flex flex-col gap-8 transition-opacity ${query.isPlaceholderData ? 'opacity-50' : ''}`}
    >
      <Stats overview={overview} />
      <JobRunsChart overview={overview} />
      <AgentsGlance agents={overview.agents} />
    </div>
  )
}

export const Overview = () => {
  const { data: session } = authClient.useSession()
  const { data: organization, isPending } = authClient.useActiveOrganization()
  const { range } = route.useSearch()
  const navigate = route.useNavigate()
  const setRange = (range: OverviewRange) =>
    void navigate({ search: (prev) => ({ ...prev, range }), replace: true })
  const name = session?.user.name.split(' ')[0]

  return (
    <Page
      wide
      title="Overview"
      eyebrow="Overview"
      heading={name ? `Welcome back, ${name}.` : 'Welcome back.'}
      description="Here's what's happening with your agents and CI jobs."
      actions={
        (isPending || organization) && (
          <RangePicker
            ranges={overviewRanges}
            value={range}
            onChange={setRange}
          />
        )
      }
    >
      {isPending || organization ? (
        <OverviewContent organizationId={organization?.id} range={range} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to see its overview.
        </p>
      )}
    </Page>
  )
}
