import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { BadgeCheckIcon, PlugIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { LoadError } from '@/components/loading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { AuthLayout } from '@/features/auth/auth-layout'
import {
  consentClientQuery,
  pendingAuthorization,
  scopeDescriptions,
  verifiedHost,
} from '@/features/connected-apps/connected-apps'
import { api, errorDetail } from '@/lib/api'
import { authClient } from '@/lib/auth'

const route = getRouteApi('/consent')

const WRITE = 'plane:write'

// Where better-auth sends the user when an MCP client asks for access: they
// pick the organization it acts in and whether it may write, then allow or
// deny it.
export const Consent = () => {
  const { client_id: clientId = '', scope = '' } = route.useSearch()
  const requested = scope.split(' ').filter(Boolean)

  const client = useQuery({
    ...consentClientQuery(clientId),
    enabled: !!clientId && !!pendingAuthorization,
  })
  const { data: session } = authClient.useSession()
  const { data: organizations, isPending: loadingOrganizations } =
    authClient.useListOrganizations()

  const [picked, setPicked] = useState<string | undefined>(undefined)
  const organizationId =
    picked ?? session?.session.activeOrganizationId ?? organizations?.[0]?.id
  const [write, setWrite] = useState(true)
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!pendingAuthorization || !clientId) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-2xl tracking-tight">
            Nothing to approve
          </h2>
          <p className="text-muted-foreground text-sm">
            This page opens when an app asks to connect to Manica. Start again
            from the app.
          </p>
        </div>
      </AuthLayout>
    )
  }

  // Plane checks the request with better-auth and records the consent
  // and the organization, then says where to go: back to the client.
  const consent = async (accept: boolean) => {
    if (!pendingAuthorization) return
    setPending(accept ? 'allow' : 'deny')
    setError(null)
    const accepted = requested.filter((name) => name !== WRITE || write)
    const { data, error } = await api['connected-apps'].consent.post({
      oauthQuery: pendingAuthorization,
      accept,
      scope: accept ? accepted.join(' ') : undefined,
      organizationId: accept ? organizationId : undefined,
    })
    if (error) {
      setPending(null)
      setError(errorDetail(error))
      return
    }
    window.location.assign(data.url)
  }

  const name = client.data?.name || 'An app'
  const host = verifiedHost(clientId)

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border bg-muted">
            <PlugIcon className="size-5" />
          </span>
          {client.isPending ? (
            <Skeleton className="h-8 w-3/4" />
          ) : (
            <h2 className="font-semibold text-2xl tracking-tight">
              Connect {name} to Manica
            </h2>
          )}
          {host ? (
            <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <BadgeCheckIcon className="size-4 shrink-0" />
              Identified by {host}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <TriangleAlertIcon className="size-4 shrink-0" />
              This app registered itself: only connect it if you just started
              connecting it.
            </p>
          )}
        </div>

        {client.isError ? (
          <LoadError
            title="Couldn't load the app"
            error={client.error}
            retrying={client.isFetching}
            onRetry={() => void client.refetch()}
          />
        ) : (
          <>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-medium text-sm">
                Organization it acts in
              </legend>
              {loadingOrganizations ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <RadioGroup
                  value={organizationId}
                  onValueChange={(value) => setPicked(value as string)}
                  className="gap-0 divide-y rounded-lg ring-1 ring-foreground/10"
                >
                  {organizations?.map((organization) => (
                    <Label
                      key={organization.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 font-normal"
                    >
                      <RadioGroupItem value={organization.id} />
                      {organization.name}
                    </Label>
                  ))}
                </RadioGroup>
              )}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-medium text-sm">It can</legend>
              <ul className="flex flex-col gap-3">
                {requested.map((name) => {
                  const description = scopeDescriptions[name]
                  if (!description) return null
                  return (
                    <li key={name}>
                      <Label className="flex items-start gap-3 font-normal">
                        <Checkbox
                          className="mt-0.5"
                          checked={name === WRITE ? write : true}
                          disabled={description.required}
                          onCheckedChange={(checked) =>
                            name === WRITE && setWrite(checked)
                          }
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">
                            {description.label}
                          </span>
                          <span className="text-muted-foreground">
                            {description.detail}
                          </span>
                        </span>
                      </Label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              disabled={pending !== null}
              onClick={() => void consent(false)}
            >
              {pending === 'deny' && <Spinner data-icon="inline-start" />}
              Deny
            </Button>
            <Button
              size="lg"
              disabled={pending !== null || !organizationId || !client.data}
              onClick={() => void consent(true)}
            >
              {pending === 'allow' && <Spinner data-icon="inline-start" />}
              Allow
            </Button>
          </div>
          <p className="text-center text-muted-foreground text-xs">
            Signed in as {session?.user.email}. You can disconnect it anytime
            from your profile.
          </p>
        </div>
      </div>
    </AuthLayout>
  )
}
