import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, ServerIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createDataTableColumnHelper, DataTable } from '@/components/data-table'
import { LabelChip } from '@/components/label-chip'
import { Page } from '@/components/layout'
import { LoadError } from '@/components/loading'
import { TableFilter } from '@/components/table-filter'
import { TableOptions } from '@/components/table-options'
import { Button } from '@/components/ui/button'
import { type AgentAction, AgentActions } from '@/features/agents/agent-actions'
import { AgentFormDialog } from '@/features/agents/agent-form-dialog'
import {
  type Agent,
  agentMatches,
  agentsQuery,
  formatPlatform,
} from '@/features/agents/agents'
import { DeleteAgentDialog } from '@/features/agents/delete-agent-dialog'
import { RegenerateTokenDialog } from '@/features/agents/regenerate-token-dialog'
import { authClient } from '@/lib/auth'
import { formatDate, formatLastSeen } from '@/lib/format'
import { useListParam, useParam } from '@/lib/search-params'

const column = createDataTableColumnHelper<Agent>()

// Dates arrive as ISO strings or Dates; sort them chronologically, with
// never-seen agents last.
const time = (date: Date | string | null) =>
  date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY

// Custom labels only: the built-in ones are the same for every agent on a
// platform, and listed in the edit dialog.
const Labels = ({ agent }: { agent: Agent }) => (
  <div className="flex flex-wrap gap-1">
    {agent.labels.length > 0 ? (
      agent.labels.map((label) => <LabelChip key={label}>{label}</LabelChip>)
    ) : (
      <span className="text-muted-foreground">None</span>
    )}
  </div>
)

const dataColumns = [
  column.accessor('name', {
    header: 'Name',
    enableHiding: false,
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
  }),
  column.accessor(formatPlatform, {
    id: 'platform',
    header: 'Platform',
  }),
  column.accessor('running', {
    header: 'Running',
    sortDescFirst: true,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.running}
        <span className="text-muted-foreground"> / {row.original.slots}</span>
      </span>
    ),
  }),
  column.accessor((agent) => agent.labels.join(' '), {
    id: 'labels',
    header: 'Labels',
    enableSorting: false,
    cell: ({ row }) => <Labels agent={row.original} />,
  }),
  column.accessor('version', {
    header: 'Version',
    cell: ({ getValue }) => {
      const version = getValue()
      return version ? (
        <span className="font-mono text-xs">{version}</span>
      ) : (
        <span className="text-muted-foreground">Unknown</span>
      )
    },
  }),
  column.accessor((agent) => time(agent.lastSeenAt), {
    id: 'lastSeenAt',
    header: 'Last seen',
    sortDescFirst: true,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatLastSeen(row.original.lastSeenAt)}
      </span>
    ),
  }),
  column.accessor((agent) => time(agent.createdAt), {
    id: 'createdAt',
    header: 'Created',
    sortDescFirst: true,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  }),
]

const hideableColumns = [
  { id: 'platform', label: 'Platform' },
  { id: 'running', label: 'Running' },
  { id: 'labels', label: 'Labels' },
  { id: 'version', label: 'Version' },
  { id: 'lastSeenAt', label: 'Last seen' },
  { id: 'createdAt', label: 'Created' },
]

const Empty = ({ title, detail }: { title: string; detail: string }) => (
  <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
    <ServerIcon className="mb-2 size-6 text-muted-foreground" />
    <p className="font-medium text-sm">{title}</p>
    <p className="whitespace-normal text-muted-foreground text-sm">{detail}</p>
  </div>
)

const AgentList = ({
  organizationId,
}: {
  organizationId: string | undefined
}) => {
  const queryClient = useQueryClient()
  const query = useQuery(agentsQuery(organizationId))
  const agents = query.data
  // The open dialog, if any. The agent it acts on outlives it, so the dialog
  // keeps its content while it animates closed.
  const [dialog, setDialog] = useState<'create' | AgentAction | null>(null)
  const [target, setTarget] = useState<Agent>()
  const [text, setText] = useParam('q')
  const [platforms, setPlatforms] = useListParam('platform')
  const [hidden, setHidden] = useListParam('hide')

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: agentsQuery(organizationId).queryKey,
    })

  const columns = useMemo(
    () =>
      column.columns([
        ...dataColumns,
        column.display({
          id: 'actions',
          enableHiding: false,
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) => (
            <div className="flex justify-end">
              <AgentActions
                agent={row.original}
                onAction={(action, agent) => {
                  setTarget(agent)
                  setDialog(action)
                }}
              />
            </div>
          ),
        }),
      ]),
    [],
  )

  const platformOptions = useMemo(
    () => [...new Set((agents ?? []).map(formatPlatform))].sort(),
    [agents],
  )

  const shown = useMemo(
    () =>
      (agents ?? []).filter(
        (agent) =>
          agentMatches(agent, text) &&
          (platforms.length === 0 || platforms.includes(formatPlatform(agent))),
      ),
    [agents, text, platforms],
  )

  const columnVisibility = useMemo(
    () => Object.fromEntries(hidden.map((id) => [id, false])),
    [hidden],
  )

  const dialogProps = (kind: NonNullable<typeof dialog>) => ({
    open: dialog === kind,
    onOpenChange: (open: boolean) => setDialog(open ? kind : null),
  })

  return (
    <>
      <DataTable
        columns={columns}
        data={shown}
        getRowId={(agent) => agent.id}
        initialSorting={[{ id: 'createdAt', desc: true }]}
        columnVisibility={columnVisibility}
        loading={query.isPending}
        error={
          query.isError &&
          !agents && (
            <LoadError
              title="Couldn't load agents"
              error={query.error}
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          )
        }
        toolbar={
          <>
            <TableFilter
              value={text}
              onChange={setText}
              placeholder="Filter agents…"
            />
            <TableOptions
              facet="Platform"
              options={platformOptions}
              selected={platforms}
              onSelectedChange={setPlatforms}
              columns={hideableColumns}
              hidden={hidden}
              onHiddenChange={setHidden}
            />
            <Button onClick={() => setDialog('create')}>
              <PlusIcon data-icon="inline-start" />
              Create agent
            </Button>
          </>
        }
        empty={
          agents?.length === 0 ? (
            <Empty
              title="No agents yet"
              detail="Create one, then run it on a machine to start running CI jobs."
            />
          ) : (
            <Empty
              title="No matching agents"
              detail="Try another filter or platform."
            />
          )
        }
      />
      <AgentFormDialog {...dialogProps('create')} onSaved={refresh} />
      <AgentFormDialog
        {...dialogProps('edit')}
        agent={target}
        onSaved={refresh}
      />
      <RegenerateTokenDialog
        {...dialogProps('regenerate-token')}
        agent={target}
      />
      <DeleteAgentDialog
        {...dialogProps('delete')}
        agent={target}
        onDeleted={refresh}
      />
    </>
  )
}

export const Agents = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()

  return (
    <Page
      wide
      title="Agents"
      description={
        organization
          ? `Machines that run ${organization.name}'s CI jobs.`
          : undefined
      }
      describing={isPending}
    >
      {isPending || organization ? (
        <AgentList organizationId={organization?.id} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to manage its agents.
        </p>
      )}
    </Page>
  )
}
