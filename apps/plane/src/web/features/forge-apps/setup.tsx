import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeftIcon, CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { forgeAppQuery, forgeLabels } from '@/features/forge-apps/forge-apps'
import { authClient } from '@/lib/auth'

const successRoute = getRouteApi('/_signedIn/forge-apps/setup/success')
const errorRoute = getRouteApi('/_signedIn/forge-apps/setup/error')

// Landing pages for `GET /api/forge-apps/setup/callback`.

export const ForgeAppSetupSuccess = () => {
  const { app: appId } = successRoute.useSearch()
  const { data: organization, isPending } = authClient.useActiveOrganization()
  const query = useQuery(forgeAppQuery(organization?.id, appId))
  const app = query.data
  // Until the app arrives its name and install link are unknown: hold their
  // place. If it can't be found, fall back to generic copy.
  const loading = isPending || (!!organization && !!appId && query.isPending)

  return (
    <Page title="Forge apps">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CircleCheckIcon className="mb-2 size-6 text-emerald-500" />
          {loading ? (
            <div aria-busy className="flex flex-col gap-2">
              <span className="sr-only">Loading…</span>
              <Skeleton className="my-0.5 h-4 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              <CardTitle>
                {app ? `${app.name} is ready` : 'Your app is ready'}
              </CardTitle>
              <CardDescription>
                {app
                  ? `The ${forgeLabels[app.forge]} app was created on ${app.owner}. Install it on the repositories whose jobs Manica should run.`
                  : 'Install it on the repositories whose jobs Manica should run.'}
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardFooter className="gap-2">
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            app?.installUrl && (
              <a href={app.installUrl} className={buttonVariants()}>
                Install app
              </a>
            )
          )}
          <Link
            to="/forge-apps"
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
  const { code } = errorRoute.useSearch()
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
          <Link to="/forge-apps" className={buttonVariants()}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back to forge apps
          </Link>
        </CardFooter>
      </Card>
    </Page>
  )
}
