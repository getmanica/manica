import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PlugIcon } from 'lucide-react'
import { useState } from 'react'
import { LoadError } from '@/components/loading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  type ConnectedApp,
  connectedAppsQuery,
  verifiedHost,
} from '@/features/connected-apps/connected-apps'
import { api, errorDetail } from '@/lib/api'
import { formatDate } from '@/lib/format'

const label = (app: ConnectedApp) => app.name || 'Unnamed app'

const access = (app: ConnectedApp) =>
  app.scopes?.includes('plane:write') ? 'Reads and manages agents' : 'Reads'

const DisconnectDialog = ({
  app,
  open,
  onOpenChange,
}: {
  app?: ConnectedApp
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const disconnect = async () => {
    if (!app) return
    setPending(true)
    setError(null)
    const { error } = await api['connected-apps'].delete(
      {},
      {
        query: { clientId: app.clientId },
      },
    )
    setPending(false)
    if (error) {
      setError(errorDetail(error))
      return
    }
    await queryClient.invalidateQueries({
      queryKey: connectedAppsQuery.queryKey,
    })
    onOpenChange(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        if (!open) setError(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Disconnect {app ? label(app) : 'app'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            It loses access to {app?.organizationName ?? 'the organization'}{' '}
            right away. To use it again, connect it again from the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => void disconnect()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// The MCP clients the user connected, each to one organization, with a way
// to disconnect them.
export const ConnectedApps = () => {
  const apps = useQuery(connectedAppsQuery)
  // Kept while its dialog closes, so the dialog doesn't change under the
  // animation.
  const [disconnecting, setDisconnecting] = useState<ConnectedApp>()
  const [confirming, setConfirming] = useState(false)

  if (apps.isPending) return <Skeleton className="h-16 w-full" />
  if (apps.isError) {
    return (
      <LoadError
        title="Couldn't load connected apps"
        error={apps.error}
        retrying={apps.isFetching}
        onRetry={() => void apps.refetch()}
      />
    )
  }
  if (apps.data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No apps connected. Add Manica to an MCP client, such as Claude Code or
        Cursor, with its <code className="text-foreground">/mcp</code> URL.
      </p>
    )
  }
  return (
    <>
      <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
        {apps.data.map((app) => (
          <li key={app.clientId} className="flex items-center gap-3 px-4 py-3">
            <PlugIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium text-sm">
                {label(app)}
                {verifiedHost(app.clientId) && (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {verifiedHost(app.clientId)}
                  </span>
                )}
              </span>
              <span className="truncate text-muted-foreground text-xs">
                {access(app)} in {app.organizationName} · Connected{' '}
                {formatDate(app.connectedAt)}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDisconnecting(app)
                setConfirming(true)
              }}
            >
              Disconnect
            </Button>
          </li>
        ))}
      </ul>
      <DisconnectDialog
        app={disconnecting}
        open={confirming}
        onOpenChange={setConfirming}
      />
    </>
  )
}
