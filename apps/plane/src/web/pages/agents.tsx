import { PlusIcon, ServerIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type AgentAction,
  AgentActions,
} from '@/components/agents/agent-actions'
import { AgentFormDialog } from '@/components/agents/agent-form-dialog'
import { DeleteAgentDialog } from '@/components/agents/delete-agent-dialog'
import { RegenerateTokenDialog } from '@/components/agents/regenerate-token-dialog'
import { createDataTableColumnHelper, DataTable } from '@/components/data-table'
import { Page } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  type Agent,
  formatDate,
  formatLastSeen,
  formatPlatform,
} from '@/lib/agents'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'

const column = createDataTableColumnHelper<Agent>()

// Dates arrive as ISO strings or Dates; sort them chronologically, with
// never-seen agents last.
const time = (date: Date | string | null) =>
  date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY

const dataColumns = [
  column.accessor('name', {
    header: 'Name',
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
  }),
  column.accessor(formatPlatform, {
    id: 'platform',
    header: 'Platform',
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

const NoAgents = () => (
  <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
    <ServerIcon className="mb-2 size-6 text-muted-foreground" />
    <p className="font-medium text-sm">No agents yet</p>
    <p className="text-muted-foreground text-sm">
      Create one, then run it on a machine to start running CI jobs.
    </p>
  </div>
)

const AgentList = () => {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  // The open dialog, if any. The agent it acts on outlives it, so the dialog
  // keeps its content while it animates closed.
  const [dialog, setDialog] = useState<'create' | AgentAction | null>(null)
  const [target, setTarget] = useState<Agent>()

  const refresh = useCallback(() => {
    void api.agents.get().then(({ data }) => setAgents(data ?? []))
  }, [])

  useEffect(refresh, [refresh])

  const columns = useMemo(
    () =>
      column.columns([
        ...dataColumns,
        column.display({
          id: 'actions',
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

  const dialogProps = (kind: NonNullable<typeof dialog>) => ({
    open: dialog === kind,
    onOpenChange: (open: boolean) => setDialog(open ? kind : null),
  })

  if (!agents) return null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setDialog('create')}>
          <PlusIcon data-icon="inline-start" />
          Create agent
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={agents}
        getRowId={(agent) => agent.id}
        initialSorting={[{ id: 'createdAt', desc: true }]}
        empty={<NoAgents />}
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
    </div>
  )
}

export const Agents = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()

  return (
    <Page
      title="Agents"
      description={
        organization
          ? `Machines that run ${organization.name}'s CI jobs.`
          : undefined
      }
    >
      {isPending ? null : organization ? (
        // Remounts, and refetches, when the active organization changes.
        <AgentList key={organization.id} />
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to manage its agents.
        </p>
      )}
    </Page>
  )
}
