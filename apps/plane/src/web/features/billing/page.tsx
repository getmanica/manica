import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { ArrowLeftRightIcon, CheckIcon, CircleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { Page } from '@/components/layout'
import { LoadError, Loading } from '@/components/loading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type BillingPlan,
  billingKey,
  billingQuery,
  type EnabledBilling,
  formatLimit,
  formatPrice,
  type Limit,
  limitLabels,
} from '@/features/billing/billing'
import { api, errorDetail } from '@/lib/api'
import { authClient } from '@/lib/auth'
import { formatDate } from '@/lib/format'

const limits = Object.keys(limitLabels) as Limit[]

// Where Stripe sends the user back to.
const here = () => `${window.location.origin}/billing`

const subscriptionLine = ({ subscription }: EnabledBilling) => {
  if (!subscription) return 'No subscription: you are on the free plan.'
  if (subscription.status === 'past_due') {
    return 'Your last payment failed: update your payment method to keep your plan.'
  }
  const ends = subscription.cancelAt ?? subscription.periodEnd
  if ((subscription.cancelAtPeriodEnd || subscription.cancelAt) && ends) {
    return `Cancelled: your plan ends on ${formatDate(ends)}.`
  }
  const interval =
    subscription.billingInterval === 'year' ? 'Yearly' : 'Monthly'
  return subscription.periodEnd
    ? `${interval}, renews on ${formatDate(subscription.periodEnd)}.`
    : interval
}

const CurrentPlan = ({ billing }: { billing: EnabledBilling }) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const manage = async () => {
    setPending(true)
    setError(null)
    const { data, error } = await api.billing.portal.post()
    if (error) {
      setPending(false)
      setError(errorDetail(error))
      return
    }
    window.location.assign(data.url)
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Current plan</CardDescription>
        <CardTitle className="text-xl">
          {billing.plan?.name ?? 'Unlimited'}
        </CardTitle>
        <CardDescription>{subscriptionLine(billing)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {limits.map((limit) => {
          const { used, max } = billing.usage[limit]
          const share = max ? Math.min(used / max, 1) : 0
          return (
            <div key={limit} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">
                  {limitLabels[limit]}
                </span>
                <span className="tabular-nums">
                  {used} / {formatLimit(max)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${max !== null && used > max ? 'bg-destructive' : 'bg-primary'}`}
                  style={{ width: `${max === null ? 0 : share * 100}%` }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
      {billing.portal && (
        <CardFooter className="flex flex-col items-start gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button variant="outline" disabled={pending} onClick={manage}>
            {pending && <Spinner data-icon="inline-start" />}
            Manage subscription
          </Button>
        </CardFooter>
      )}
    </Card>
  )
}

const PlanCard = ({
  plan,
  annual,
  current,
  subscribed,
  onError,
}: {
  plan: BillingPlan
  annual: boolean
  current: boolean
  // Has a subscription to switch, rather than one to start.
  subscribed: boolean
  onError: (message: string) => void
}) => {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const offered = annual ? plan.yearly : plan.monthly
  const price = formatPrice(annual ? plan.prices.yearly : plan.prices.monthly)

  // A first subscription goes through Stripe's checkout; switching one
  // happens at once, prorated on the next invoice.
  const subscribe = async () => {
    setPending(true)
    if (subscribed) {
      const { error } = await api.billing.plan.post({ plan: plan.id, annual })
      setPending(false)
      if (error) return onError(errorDetail(error))
      void queryClient.invalidateQueries({ queryKey: billingKey })
      return
    }
    const { error } = await authClient.subscription.upgrade({
      plan: plan.id,
      annual,
      successUrl: here(),
      cancelUrl: here(),
    })
    // On success the browser is on its way to Stripe's checkout.
    if (!error) return
    setPending(false)
    onError(error.message ?? 'Something went wrong')
  }

  return (
    <Card className={current ? 'ring-2 ring-primary' : undefined}>
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        {offered && price && (
          <p>
            <span className="font-semibold text-2xl">{price}</span>
            <span className="text-muted-foreground text-sm">
              {annual ? ' / year' : ' / month'}
            </span>
          </p>
        )}
        {plan.description && (
          <CardDescription>{plan.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="flex flex-col gap-2 text-sm">
          {limits.map((limit) => (
            <li key={limit} className="flex items-center gap-2">
              <CheckIcon className="size-4 text-muted-foreground" />
              {plan.limits[limit] === null
                ? `Unlimited ${limitLabels[limit].toLowerCase()}`
                : `${plan.limits[limit]} ${limitLabels[limit].toLowerCase()}`}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={current || !offered || pending}
          onClick={subscribe}
        >
          {pending && <Spinner data-icon="inline-start" />}
          {current
            ? 'Current plan'
            : offered
              ? subscribed
                ? 'Switch to this plan'
                : 'Choose plan'
              : `Not offered ${annual ? 'yearly' : 'monthly'}`}
        </Button>
      </CardFooter>
    </Card>
  )
}

const Plans = ({ billing }: { billing: EnabledBilling }) => {
  const [yearly, setYearly] = useState(
    billing.subscription?.billingInterval === 'year',
  )
  const [error, setError] = useState<string | null>(null)
  if (billing.plans.length === 0) return null
  const anyYearly = billing.plans.some((plan) => plan.yearly)
  // Without a yearly offer there's no toggle: monthly it is.
  const annual = yearly && anyYearly
  const setAnnual = setYearly

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-lg">Plans</h2>
        {anyYearly && (
          <Tabs
            value={annual ? 'yearly' : 'monthly'}
            onValueChange={(value) => setAnnual(value === 'yearly')}
          >
            <TabsList>
              <TabsTrigger value="monthly">Monthly</TabsTrigger>
              <TabsTrigger value="yearly">Yearly</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {billing.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            annual={annual}
            current={
              !!billing.subscription &&
              billing.plan?.id === plan.id &&
              (billing.subscription.billingInterval === 'year') === annual
            }
            subscribed={
              billing.subscription?.status === 'active' ||
              billing.subscription?.status === 'trialing'
            }
            onError={setError}
          />
        ))}
      </div>
    </section>
  )
}

// Disabled by itself, or with its whole organization.
const isDisabled = (resource: Resource) =>
  !!resource.disabledAt || !!resource.organizationDisabled

type Resource = {
  id: string
  name: string
  organization?: string
  disabledAt: Date | string | null
  personal?: boolean
  organizationDisabled?: boolean
}

// A disabled resource, and the enabled ones it can take the place of.
const DisabledRow = ({
  limit,
  resource,
  enabled,
  onSwapped,
}: {
  limit: Limit
  resource: Resource
  enabled: Resource[]
  onSwapped: (error?: string) => void
}) => {
  const [pending, setPending] = useState(false)
  const candidates = enabled.filter((other) => !other.personal)

  const swap = async (disable: string) => {
    setPending(true)
    const { error } = await api.billing.swap.post({
      kind: limit,
      enable: resource.id,
      disable,
    })
    setPending(false)
    onSwapped(error ? errorDetail(error) : undefined)
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-sm">{resource.name}</span>
        {resource.organization && (
          <span className="truncate text-muted-foreground text-xs">
            {resource.organization}
          </span>
        )}
      </div>
      {resource.organizationDisabled ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          Its organization is disabled: keep that first
        </span>
      ) : (
        candidates.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={pending}>
                  {pending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ArrowLeftRightIcon data-icon="inline-start" />
                  )}
                  Keep instead of…
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Disable in its place</DropdownMenuLabel>
              {candidates.map((other) => (
                <DropdownMenuItem key={other.id} onClick={() => swap(other.id)}>
                  {other.name}
                  {other.organization && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {other.organization}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      )}
    </li>
  )
}

const Disabled = ({ billing }: { billing: EnabledBilling }) => {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const kinds = limits.filter((limit) =>
    billing.resources[limit].some(isDisabled),
  )
  if (kinds.length === 0) return null

  const onSwapped = (failed?: string) => {
    setError(failed ?? null)
    void queryClient.invalidateQueries({ queryKey: billingKey })
  }

  return (
    <section className="flex flex-col gap-4">
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Some of your resources are disabled</AlertTitle>
        <AlertDescription>
          You have more than your plan allows. The newest were disabled:
          disabled agents get no jobs, disabled forge apps' deliveries are
          ignored, and disabled organizations are read-only. Upgrade, delete
          some, or pick which to keep.
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {kinds.map((limit) => {
        const resources: Resource[] = billing.resources[limit]
        return (
          <Card key={limit} className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-base">
                Disabled {limitLabels[limit].toLowerCase()}
              </CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {resources.filter(isDisabled).map((resource) => (
                <DisabledRow
                  key={resource.id}
                  limit={limit}
                  resource={resource}
                  // Taking the place of one off through its organization frees
                  // its slot for one that works.
                  enabled={resources.filter((other) => !other.disabledAt)}
                  onSwapped={onSwapped}
                />
              ))}
            </ul>
          </Card>
        )
      })}
    </section>
  )
}

export const BillingPage = () => {
  // Fresh on every visit: what's enabled changes as resources come and go.
  const query = useQuery({ ...billingQuery, refetchOnMount: 'always' })
  const billing = query.data

  // The plane has no billing: nothing to show.
  if (billing && !billing.enabled) return <Navigate to="/" replace />

  return (
    <Page
      title="Billing"
      description="Your plan covers the organizations you created, and the agents and forge apps in them."
    >
      {query.isError && !billing ? (
        <LoadError
          title="Couldn't load billing"
          error={query.error}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : !billing?.enabled ? (
        <Loading>
          <Skeleton className="h-48 w-full" />
        </Loading>
      ) : (
        <>
          <CurrentPlan billing={billing} />
          <Disabled billing={billing} />
          <Plans billing={billing} />
        </>
      )}
    </Page>
  )
}
