import { ArrowLeftIcon, CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'wouter'
import { Page } from '@/components/layout'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { api } from '@/lib/api'
import { type ForgeApp, forgeLabels } from '@/lib/forge-apps'

// Landing pages for `GET /api/forge-apps/setup/callback`.

export const ForgeAppSetupSuccess = () => {
  const [params] = useSearchParams()
  const appId = params.get('app')
  const [app, setApp] = useState<ForgeApp | null>(null)

  useEffect(() => {
    void api['forge-apps']
      .get()
      .then(({ data }) => setApp(data?.find(({ id }) => id === appId) ?? null))
  }, [appId])

  return (
    <Page title="Forge apps">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CircleCheckIcon className="mb-2 size-6 text-emerald-500" />
          <CardTitle>
            {app ? `${app.name} is ready` : 'Your app is ready'}
          </CardTitle>
          <CardDescription>
            {app
              ? `The ${forgeLabels[app.forge]} app was created on ${app.owner}. Install it on the repositories whose jobs Manica should run.`
              : 'Install it on the repositories whose jobs Manica should run.'}
          </CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          {app?.installUrl && (
            <a href={app.installUrl} className={buttonVariants()}>
              Install app
            </a>
          )}
          <Link
            href="/forge-apps"
            className={buttonVariants({ variant: 'ghost' })}
          >
            Back to forge apps
          </Link>
        </CardFooter>
      </Card>
    </Page>
  )
}

const errorMessages: Record<string, { title: string; description: string }> = {
  FORGE_APP_SETUP_CALLBACK_INVALID: {
    title: 'Incomplete response from the forge',
    description:
      'The forge sent you back without the details Manica needs to finish the setup.',
  },
  FORGE_APP_SETUP_INVALID: {
    title: 'This setup has expired',
    description:
      'Setups are valid for an hour and can only be completed once, by the person who started them.',
  },
  FORGE_APP_SETUP_FAILED: {
    title: 'The forge rejected the setup',
    description:
      'The forge could not hand over the app. If it was created, delete it on the forge before trying again.',
  },
  UNAUTHORIZED: {
    title: 'You were signed out',
    description: 'Sign in again, then start the setup over.',
  },
}

const fallbackError = {
  title: 'Something went wrong',
  description: 'The app could not be set up. Try again in a moment.',
}

export const ForgeAppSetupError = () => {
  const [params] = useSearchParams()
  const code = params.get('code')
  const { title, description } = (code && errorMessages[code]) || fallbackError

  return (
    <Page title="Forge apps">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CircleAlertIcon className="mb-2 size-6 text-destructive" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {code && (
          <CardContent>
            <code className="text-muted-foreground text-xs">{code}</code>
          </CardContent>
        )}
        <CardFooter>
          <Link href="/forge-apps" className={buttonVariants()}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back to forge apps
          </Link>
        </CardFooter>
      </Card>
    </Page>
  )
}
