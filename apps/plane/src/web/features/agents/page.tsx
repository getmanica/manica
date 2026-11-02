import type { AgentSort } from '@shared/pagination'
import { type PlatformKey, platformKey } from '@shared/platform'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
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
  agentsKey,
  agentsQuery,
  formatPlatform,
  parsePlatformKey,
} from '@/features/agents/agents'
import { DeleteAgentDialog } from '@/features/agents/delete-agent-dialog'
import { RegenerateTokenDialog } from '@/features/agents/regenerate-token-dialog'
import { authClient } from '@/lib/auth'
import { formatDate, formatLastSeen } from '@/lib/format'

const route = getRouteApi('/_signedIn/agents')

const column = createDataTableColumnHelper<Agent>()

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
  column.accessor(platformKey, {
    id: 'platform',
    cell: ({ row }) => formatPlatform(row.original),
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
  column.accessor('lastSeenAt', {
    header: 'Last seen',
    sortDescFirst: true,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatLastSeen(row.original.lastSeenAt)}
      </span>
    ),
  }),
  column.accessor('createdAt', {
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
  // The open dialog, if any. The agent it acts on outlives it, so the dialog
  // keeps its content while it animates closed.
  const [dialog, setDialog] = useState<'create' | AgentAction | null>(null)
  const [target, setTarget] = useState<Agent>()
  const current = route.useSearch()
  const { q: text, platform: platforms, hide: hidden, page, size } = current
  const navigate = route.useNavigate()
  // Replaces the history entry rather than adding one per keystroke. Any
  // change but the page or the columns starts over from the first page.
  const update = (search: Partial<typeof current>) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        ...(Object.keys(search).some((key) => key !== 'page' && key !== 'hide')
          ? { page: 1 }
          : {}),
        ...search,
      }),
      replace: true,
    })

  // The API is asked once typing pauses, not for every keystroke.
  const [q] = useDebouncedValue(text, { wait: 250 })
  const query = useQuery(
    agentsQuery(organizationId, {
      q: q || undefined,
      platform: platforms,
      page,
      size,
      sort: current.sort,
      dir: current.dir,
    }),
  )
  const list = query.data

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: agentsKey(organizationId) })

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
    () =>
      [...new Set([...(list?.platforms ?? []), ...platforms])]
        .map((value) => ({
          value,
          label: formatPlatform(parsePlatformKey(value)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [list?.platforms, platforms],
  )

  const filtered = text.trim() !== '' || platforms.length > 0

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
        data={list?.items ?? []}
        getRowId={(agent) => agent.id}
        sorting={{ id: current.sort, desc: current.dir === 'desc' }}
        onSortingChange={({ id, desc }) =>
          update({ sort: id as AgentSort, dir: desc ? 'desc' : 'asc' })
        }
        pagination={{
          page,
          size,
          total: list?.total,
          onPageChange: (page) => update({ page }),
          onSizeChange: (size) => update({ size }),
        }}
        columnVisibility={columnVisibility}
        loading={query.isPending}
        dimmed={query.isPlaceholderData || q !== text}
        error={
          query.isError &&
          !list && (
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
              onChange={(q) => update({ q })}
              placeholder="Filter agents…"
            />
            <TableOptions
              facet="Platform"
              options={platformOptions}
              selected={platforms}
              onSelectedChange={(platform) =>
                update({ platform: platform as PlatformKey[] })
              }
              columns={hideableColumns}
              hidden={hidden}
              onHiddenChange={(hide) => update({ hide })}
            />
            <Button onClick={() => setDialog('create')}>
              <PlusIcon data-icon="inline-start" />
              Create agent
            </Button>
          </>
        }
        empty={
          filtered ? (
            <Empty
              title="No matching agents"
              detail="Try another filter or platform."
            />
          ) : (
            <Empty
              title="No agents yet"
              detail="Create one, then run it on a machine to start running CI jobs."
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
