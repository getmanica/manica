import { ExternalLinkIcon, PlugIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAppForm } from '@/components/form/app-form'
import { Page } from '@/components/layout'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import {
  type ForgeApp,
  followSetupRedirect,
  forgeLabels,
} from '@/features/forge-apps/forge-apps'
import { api, errorDetail } from '@/lib/api'
import { authClient } from '@/lib/auth'

const ConnectGitHub = () => {
  const form = useAppForm({
    defaultValues: { owner: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const { data, error } = await api['forge-apps'].setup.post({
        forge: 'github',
        owner: value.owner.trim() || undefined,
      })
      if (error) return createValidationError(errorDetail(error))
      followSetupRedirect(data.redirect)
      // Stays submitting: the browser is leaving for GitHub.
      await new Promise<never>(() => {})
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect GitHub</CardTitle>
        <CardDescription>
          Creates a GitHub App that sends queued workflow jobs to Manica.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              <form.Field name="owner">
                {(field) => (
                  <field.Field>
                    <field.Label>GitHub organization</field.Label>
                    <field.TextInput placeholder="acme" />
                    <field.Description>
                      Leave empty to create the app on your personal account.
                    </field.Description>
                  </field.Field>
                )}
              </form.Field>
              <form.Errors />
              <Field>
                <form.SubmitButton icon={<PlugIcon data-icon="inline-start" />}>
                  Create GitHub App
                </form.SubmitButton>
              </Field>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
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
