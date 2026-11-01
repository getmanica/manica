import { ListChecksIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createDataTableColumnHelper, DataTable } from '@/components/data-table'
import { Page } from '@/components/layout'
import {
  type Job,
  jobOutcome,
  type OutcomeTone,
  outcomeTone,
} from '@/features/jobs/jobs'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'
import { formatLastSeen } from '@/lib/format'

// Jobs move on their own: the list follows along.
const REFRESH_MS = 5000

const column = createDataTableColumnHelper<Job>()

const time = (date: Date | string | null) =>
  date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY

const toneClasses: Record<OutcomeTone, string> = {
  pending: 'bg-muted-foreground',
  active: 'bg-blue-500 animate-pulse',
  good: 'bg-emerald-500',
  bad: 'bg-destructive',
  neutral: 'bg-muted-foreground/50',
}

const Outcome = ({ job }: { job: Job }) => (
  <span className="flex items-center gap-2">
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${toneClasses[outcomeTone(job)]}`}
    />
    {jobOutcome(job)}
  </span>
)

const columns = column.columns([
  column.accessor('name', {
    header: 'Job',
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
    cell: ({ row }) =>
      row.original.agentName ?? (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  column.accessor((job) => job.labels.join(' '), {
    id: 'labels',
    header: 'runs-on',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground text-xs">
        {row.original.labels.join(', ')}
      </span>
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
])

const NoJobs = () => (
  <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
    <ListChecksIcon className="mb-2 size-6 text-muted-foreground" />
    <p className="font-medium text-sm">No jobs yet</p>
    <p className="text-muted-foreground text-sm">
      Jobs show up here once a workflow asks for labels one of your agents has,
      e.g. <code className="font-mono">runs-on: [self-hosted, macOS]</code>.
    </p>
  </div>
)

const JobList = () => {
  const [jobs, setJobs] = useState<Job[] | null>(null)

  const refresh = useCallback(() => {
    void api.jobs.get().then(({ data }) => {
      if (data) setJobs(data)
    })
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  if (!jobs) return null
  return (
    <DataTable
      columns={columns}
      data={jobs}
      getRowId={(job) => job.id}
      initialSorting={[{ id: 'queuedAt', desc: true }]}
      empty={<NoJobs />}
    />
  )
}

export const Jobs = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()

  return (
    <Page
      title="Jobs"
      description={
        organization
          ? `CI jobs for ${organization.name}'s agents, most recent first.`
          : undefined
      }
    >
      {isPending ? null : organization ? (
        <JobList key={organization.id} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to see its jobs.
        </p>
      )}
    </Page>
  )
}
