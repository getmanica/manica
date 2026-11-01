import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon, PlugIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createDataTableColumnHelper, DataTable } from '@/components/data-table'
import { Page } from '@/components/layout'
import { LoadError } from '@/components/loading'
import { TableFilter } from '@/components/table-filter'
import { Button } from '@/components/ui/button'
import { ConnectGitHubDialog } from '@/features/forge-apps/connect-github-dialog'
import { ForgeAppActions } from '@/features/forge-apps/forge-app-actions'
import {
  type ForgeApp,
  forgeAppsQuery,
  forgeLabels,
} from '@/features/forge-apps/forge-apps'
import { ForgeIcon } from '@/features/forge-apps/forge-icon'
import { authClient } from '@/lib/auth'
import { formatDate, formatLastSeen, formatTime } from '@/lib/format'
import { useParam } from '@/lib/search-params'

const column = createDataTableColumnHelper<ForgeApp>()

const time = (date: Date | string | null) =>
  date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY

// Whether the forge is reaching the app. An app that never got a delivery
// is usually not installed on any repository yet.
const Status = ({ app }: { app: ForgeApp }) =>
  app.lastDeliveryAt ? (
    <div className="flex flex-col items-start gap-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-400">
        <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
      <span className="text-muted-foreground text-xs">
        Last delivery {formatLastSeen(app.lastDeliveryAt).toLowerCase()}
      </span>
    </div>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground text-xs">
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-muted-foreground/50"
      />
      No deliveries yet
    </span>
  )

const columns = column.columns([
  column.accessor('name', {
    header: 'App',
    enableHiding: false,
    cell: ({ row: { original: app } }) => (
      <div className="flex items-center gap-3">
        <ForgeIcon forge={app.forge} className="size-7 shrink-0" />
        <div className="flex flex-col">
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-medium hover:underline"
          >
            {app.name}
            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
          </a>
          <span className="text-muted-foreground text-xs">
            {forgeLabels[app.forge]} · {app.slug}
          </span>
        </div>
      </div>
    ),
  }),
  column.accessor('owner', {
    header: 'Account',
  }),
  column.accessor((app) => time(app.lastDeliveryAt), {
    id: 'status',
    header: 'Status',
    sortDescFirst: true,
    cell: ({ row }) => <Status app={row.original} />,
  }),
  column.accessor((app) => time(app.createdAt), {
    id: 'createdAt',
    header: 'Added',
    sortDescFirst: true,
    cell: ({ row: { original: app } }) => (
      <div className="flex flex-col">
        <span>{formatDate(app.createdAt)}</span>
        <span className="text-muted-foreground text-xs">
          {formatTime(app.createdAt)}
        </span>
      </div>
    ),
  }),
  column.display({
    id: 'actions',
    enableHiding: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <ForgeAppActions app={row.original} />
      </div>
    ),
  }),
])

const Empty = ({ title, detail }: { title: string; detail: string }) => (
  <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
    <PlugIcon className="mb-2 size-6 text-muted-foreground" />
    <p className="font-medium text-sm">{title}</p>
    <p className="whitespace-normal text-muted-foreground text-sm">{detail}</p>
  </div>
)

const matches = (app: ForgeApp, text: string) => {
  const needle = text.trim().toLowerCase()
  return (
    !needle ||
    [app.name, app.slug, app.owner, forgeLabels[app.forge]].some((value) =>
      value.toLowerCase().includes(needle),
    )
  )
}

const ForgeAppList = ({
  organizationId,
}: {
  organizationId: string | undefined
}) => {
  const query = useQuery(forgeAppsQuery(organizationId))
  const apps = query.data
  const [text, setText] = useParam('q')

  const shown = useMemo(
    () => (apps ?? []).filter((app) => matches(app, text)),
    [apps, text],
  )

  return (
    <DataTable
      columns={columns}
      data={shown}
      getRowId={(app) => app.id}
      initialSorting={[{ id: 'createdAt', desc: true }]}
      loading={query.isPending}
      error={
        query.isError &&
        !apps && (
          <LoadError
            title="Couldn't load forge apps"
            error={query.error}
            retrying={query.isFetching}
            onRetry={() => void query.refetch()}
          />
        )
      }
      toolbar={
        <>
          <div className="mr-auto w-full max-w-xs">
            <TableFilter
              value={text}
              onChange={setText}
              placeholder="Filter apps…"
            />
          </div>
          {apps && (
            <span className="shrink-0 px-2 text-muted-foreground text-sm">
              {apps.length} {apps.length === 1 ? 'app' : 'apps'} connected
            </span>
          )}
        </>
      }
      empty={
        apps?.length === 0 ? (
          <Empty
            title="No forge apps yet"
            detail="Connect GitHub to start receiving CI jobs."
          />
        ) : (
          <Empty title="No matching apps" detail="Try another filter." />
        )
      }
    />
  )
}

export const ForgeApps = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()
  const [connecting, setConnecting] = useState(false)

  return (
    <Page
      wide
      title="Forge apps"
      description={
        organization
          ? `Connect apps to send ${organization.name}'s CI jobs to its agents.`
          : undefined
      }
      describing={isPending}
      actions={
        (isPending || organization) && (
          <Button
            size="lg"
            disabled={!organization}
            onClick={() => setConnecting(true)}
          >
            <PlusIcon data-icon="inline-start" />
            Connect GitHub
          </Button>
        )
      }
    >
      {isPending || organization ? (
        <>
          <ForgeAppList organizationId={organization?.id} />
          {organization && (
            <ConnectGitHubDialog
              open={connecting}
              onOpenChange={setConnecting}
              organizationName={organization.name}
            />
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to manage its forge apps.
        </p>
      )}
    </Page>
  )
}
