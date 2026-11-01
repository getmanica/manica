import { type JobRange, jobRanges } from '@shared/job-ranges'
import { ListChecksIcon } from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createDataTableColumnHelper, DataTable } from '@/components/data-table'
import { LabelChip } from '@/components/label-chip'
import { Page } from '@/components/layout'
import { RangePicker, rangeLabel } from '@/components/range-picker'
import { TableFilter } from '@/components/table-filter'
import { TableOptions } from '@/components/table-options'
import { JobActions } from '@/features/jobs/job-actions'
import {
  commonOutcomes,
  type Job,
  jobMatches,
  jobOutcome,
  type OutcomeTone,
  outcomeTone,
} from '@/features/jobs/jobs'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'
import { formatLastSeen } from '@/lib/format'
import { useEnumParam, useListParam, useParam } from '@/lib/search-params'

// Jobs move on their own: the list follows along.
const REFRESH_MS = 5000

const column = createDataTableColumnHelper<Job>()

const time = (date: Date | string | null) =>
  date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY

const toneClasses: Record<OutcomeTone, { dot: string; pill: string }> = {
  pending: {
    dot: 'bg-muted-foreground',
    pill: 'bg-muted text-muted-foreground',
  },
  active: {
    dot: 'bg-blue-500 animate-pulse',
    pill: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  },
  good: {
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
  bad: {
    dot: 'bg-destructive',
    pill: 'bg-destructive/15 text-destructive',
  },
  neutral: {
    dot: 'bg-muted-foreground/50',
    pill: 'bg-muted text-foreground',
  },
}

const Outcome = ({ job }: { job: Job }) => {
  const tone = toneClasses[outcomeTone(job)]
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${tone.dot}`}
      />
      <span
        className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${tone.pill}`}
      >
        {jobOutcome(job)}
      </span>
    </span>
  )
}

const hideableColumns = [
  { id: 'repository', label: 'Repository' },
  { id: 'outcome', label: 'Status' },
  { id: 'agent', label: 'Agent' },
  { id: 'labels', label: 'Runs on' },
  { id: 'queuedAt', label: 'Queued' },
]

const None = () => <span className="text-muted-foreground">—</span>

const columns = column.columns([
  column.accessor('name', {
    header: 'Job',
    enableHiding: false,
    cell: ({ row }) => (
      <a
        href={row.original.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium hover:underline"
      >
        {row.original.name}
      </a>
    ),
  }),
  column.accessor('repository', {
    header: 'Repository',
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue()}</span>
    ),
  }),
  column.accessor(jobOutcome, {
    id: 'outcome',
    header: 'Status',
    cell: ({ row }) => <Outcome job={row.original} />,
  }),
  column.accessor((job) => job.agentName ?? '', {
    id: 'agent',
    header: 'Agent',
    cell: ({ row }) => row.original.agentName ?? <None />,
  }),
  column.accessor((job) => job.labels.join(' '), {
    id: 'labels',
    header: 'Runs on',
    cell: ({ row }) =>
      // A job that ended without an agent (e.g. skipped) never ran anywhere.
      row.original.status === 'completed' && !row.original.agentName ? (
        <None />
      ) : (
        <div className="flex gap-1">
          {row.original.labels.map((label) => (
            <LabelChip key={label}>{label}</LabelChip>
          ))}
        </div>
      ),
  }),
  column.accessor((job) => time(job.queuedAt), {
    id: 'queuedAt',
    header: 'Queued',
    sortDescFirst: true,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatLastSeen(row.original.queuedAt)}
      </span>
    ),
  }),
  column.display({
    id: 'actions',
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <JobActions job={row.original} />
      </div>
    ),
  }),
])

const Empty = ({ title, detail }: { title: string; detail: ReactNode }) => (
  <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
    <ListChecksIcon className="mb-2 size-6 text-muted-foreground" />
    <p className="font-medium text-sm">{title}</p>
    <p className="whitespace-normal text-muted-foreground text-sm">{detail}</p>
  </div>
)

const NoJobs = ({ range }: { range: JobRange }) =>
  range === 'all' ? (
    <Empty
      title="No jobs yet"
      detail={
        <>
          Jobs show up here once a workflow asks for labels one of your agents
          has, e.g.{' '}
          <code className="font-mono">runs-on: [self-hosted, macOS]</code>.
        </>
      }
    />
  ) : (
    <Empty
      title="No jobs in this range"
      detail={`Nothing was queued for your agents in the ${rangeLabel(range).toLowerCase()}.`}
    />
  )

const JobList = ({ range }: { range: JobRange }) => {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [text, setText] = useParam('q')
  const [statuses, setStatuses] = useListParam('status')
  const [hidden, setHidden] = useListParam('hide')

  const refresh = useCallback(() => {
    void api.jobs.get({ query: { range } }).then(({ data }) => {
      if (data) setJobs(data)
    })
  }, [range])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const outcomes = useMemo(
    () => [...new Set([...commonOutcomes, ...(jobs ?? []).map(jobOutcome)])],
    [jobs],
  )

  const shown = useMemo(
    () =>
      (jobs ?? []).filter(
        (job) =>
          jobMatches(job, text) &&
          (statuses.length === 0 || statuses.includes(jobOutcome(job))),
      ),
    [jobs, text, statuses],
  )

  const columnVisibility = useMemo(
    () => Object.fromEntries(hidden.map((id) => [id, false])),
    [hidden],
  )

  if (!jobs) return null
  return (
    <DataTable
      columns={columns}
      data={shown}
      getRowId={(job) => job.id}
      initialSorting={[{ id: 'queuedAt', desc: true }]}
      columnVisibility={columnVisibility}
      toolbar={
        <>
          <TableFilter
            value={text}
            onChange={setText}
            placeholder="Filter jobs…"
          />
          <TableOptions
            facet="Status"
            options={outcomes}
            selected={statuses}
            onSelectedChange={setStatuses}
            columns={hideableColumns}
            hidden={hidden}
            onHiddenChange={setHidden}
          />
        </>
      }
      empty={
        jobs.length === 0 ? (
          <NoJobs range={range} />
        ) : (
          <Empty
            title="No matching jobs"
            detail="Try another filter or status."
          />
        )
      }
    />
  )
}

export const Jobs = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()
  const [range, setRange] = useEnumParam('range', jobRanges, '24h')

  return (
    <Page
      wide
      title="Jobs"
      description={
        organization
          ? `CI jobs for ${organization.name}'s agents, most recent first.`
          : undefined
      }
      actions={
        organization && (
          <RangePicker ranges={jobRanges} value={range} onChange={setRange} />
        )
      }
    >
      {isPending ? null : organization ? (
        <JobList key={organization.id} range={range} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to see its jobs.
        </p>
      )}
    </Page>
  )
}
