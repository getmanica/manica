import { ExternalLinkIcon, PlugIcon } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { Page } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  type ForgeApp,
  followSetupRedirect,
  forgeLabels,
} from '@/features/forge-apps/forge-apps'
import { api } from '@/lib/api'
import { authClient } from '@/lib/auth'

const ConnectGitHub = () => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const owner = String(new FormData(event.currentTarget).get('owner')).trim()

    setPending(true)
    setError(null)
    const { data, error } = await api['forge-apps'].setup.post({
      forge: 'github',
      owner: owner || undefined,
    })
    if (error) {
      setPending(false)
      setError(
        (error.value as { detail?: string }).detail ?? 'Something went wrong',
      )
      return
    }
    // Stays pending: the browser is leaving for GitHub.
    followSetupRedirect(data.redirect)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect GitHub</CardTitle>
        <CardDescription>
          Creates a GitHub App that sends queued workflow jobs to Manica.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(event) => void onSubmit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="owner">GitHub organization</FieldLabel>
              <Input id="owner" name="owner" placeholder="acme" />
              <FieldDescription>
                Leave empty to create the app on your personal account.
              </FieldDescription>
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PlugIcon data-icon="inline-start" />
                )}
                Create GitHub App
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

const ForgeAppCard = ({ app }: { app: ForgeApp }) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle>
        <a
          href={app.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          {app.name}
          <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
        </a>
      </CardTitle>
      <CardDescription>
        {forgeLabels[app.forge]} · {app.owner}
      </CardDescription>
      {app.installUrl && (
        <CardAction>
          <a
            href={app.installUrl}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Install
          </a>
        </CardAction>
      )}
    </CardHeader>
  </Card>
)

const ForgeAppList = () => {
  const [apps, setApps] = useState<ForgeApp[] | null>(null)

  useEffect(() => {
    void api['forge-apps'].get().then(({ data }) => setApps(data ?? []))
  }, [])

  if (!apps) return null
  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-12 text-center">
        <PlugIcon className="mb-2 size-6 text-muted-foreground" />
        <p className="font-medium text-sm">No forge apps yet</p>
        <p className="text-muted-foreground text-sm">
          Create one to start receiving CI jobs.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {apps.map((app) => (
        <ForgeAppCard key={app.id} app={app} />
      ))}
    </div>
  )
}

export const ForgeApps = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()

  return (
    <Page
      title="Forge apps"
      description={
        organization
          ? `Apps that send ${organization.name}'s CI jobs to its runners.`
          : undefined
      }
    >
      {isPending ? null : organization ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {/* Remounts, and refetches, when the active organization changes. */}
          <ForgeAppList key={organization.id} />
          <ConnectGitHub />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to manage its forge apps.
        </p>
      )}
    </Page>
  )
}
