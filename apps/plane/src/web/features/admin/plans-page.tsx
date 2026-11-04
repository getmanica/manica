import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Page } from '@/components/layout'
import { LoadError, Loading } from '@/components/loading'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PlanFormDialog } from '@/features/admin/plan-form-dialog'
import { type AdminPlan, plansKey, plansQuery } from '@/features/admin/plans'
import { formatLimit } from '@/features/billing/billing'
import { api, errorDetail } from '@/lib/api'

const Badge = ({
  tone,
  children,
}: {
  tone: 'muted' | 'blue' | 'green'
  children: string
}) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs ${
      {
        muted: 'bg-muted text-muted-foreground',
        blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
        green: 'bg-green-500/15 text-green-700 dark:text-green-400',
      }[tone]
    }`}
  >
    {children}
  </span>
)

const DeletePlanDialog = ({
  plan,
  open,
  onOpenChange,
  onDeleted,
}: {
  plan?: AdminPlan
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const remove = async () => {
    if (!plan) return
    setPending(true)
    setError(null)
    const { error } = await api.admin.plans({ id: plan.id }).delete()
    setPending(false)
    if (error) return setError(errorDetail(error))
    onDeleted()
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
          <AlertDialogTitle>Delete {plan?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only plans nobody is subscribed to can be deleted. Its Stripe
            product and prices stay in Stripe.
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
            onClick={(event) => {
              event.preventDefault()
              void remove()
            }}
          >
            {pending && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const prices = (plan: AdminPlan) =>
  plan.isDefault
    ? 'Free'
    : [plan.monthlyPriceId && 'Monthly', plan.yearlyPriceId && 'Yearly']
        .filter(Boolean)
        .join(' · ')

export const AdminPlans = () => {
  const queryClient = useQueryClient()
  const query = useQuery(plansQuery)
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const [target, setTarget] = useState<AdminPlan>()
  const [orderError, setOrderError] = useState<string | null>(null)
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: plansKey })

  // The paid plans, in the order users see them: the default plan isn't
  // picked, so it stays first.
  const paid = query.data?.items.filter((plan) => !plan.isDefault) ?? []
  const move = async (plan: AdminPlan, by: -1 | 1) => {
    const ids = paid.map(({ id }) => id)
    const from = ids.indexOf(plan.id)
    const to = from + by
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to] as string, ids[from] as string]
    setOrderError(null)
    const { error } = await api.admin.plans.order.put({ ids })
    if (error) setOrderError(errorDetail(error))
    refresh()
  }

  const open = (kind: 'edit' | 'delete', plan?: AdminPlan) => {
    setTarget(plan)
    setDialog(kind)
  }

  return (
    <Page
      wide
      title="Plans"
      eyebrow="Admin"
      description="What users can subscribe to, and what each plan lets them have across the organizations they create. Users see the plans in this order."
      actions={
        <Button onClick={() => open('edit')}>
          <PlusIcon />
          Create plan
        </Button>
      }
    >
      {query.data && !query.data.billing && (
        <Alert>
          <AlertDescription>
            Billing is off: set STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET to turn
            it on. Until then plans apply to nobody and nothing is limited.
          </AlertDescription>
        </Alert>
      )}
      {orderError && (
        <Alert variant="destructive">
          <AlertDescription>{orderError}</AlertDescription>
        </Alert>
      )}
      {query.isError && !query.data ? (
        <LoadError
          title="Couldn't load plans"
          error={query.error}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : !query.data ? (
        <Loading>
          <Skeleton className="h-40 w-full" />
        </Loading>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Prices</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Forge apps</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{plan.name}</span>
                      <span className="whitespace-normal text-muted-foreground text-xs">
                        {plan.description}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{prices(plan)}</TableCell>
                  <TableCell>{formatLimit(plan.maxOrganizations)}</TableCell>
                  <TableCell>{formatLimit(plan.maxAgents)}</TableCell>
                  <TableCell>{formatLimit(plan.maxForgeApps)}</TableCell>
                  <TableCell>
                    {plan.isDefault ? (
                      <Badge tone="blue">Default</Badge>
                    ) : plan.enabled ? (
                      <Badge tone="green">Offered</Badge>
                    ) : (
                      <Badge tone="muted">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${plan.name}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => open('edit', plan)}>
                            Edit
                          </DropdownMenuItem>
                          {!plan.isDefault && paid[0]?.id !== plan.id && (
                            <DropdownMenuItem
                              onClick={() => void move(plan, -1)}
                            >
                              <ArrowUpIcon />
                              Move up
                            </DropdownMenuItem>
                          )}
                          {!plan.isDefault && paid.at(-1)?.id !== plan.id && (
                            <DropdownMenuItem
                              onClick={() => void move(plan, 1)}
                            >
                              <ArrowDownIcon />
                              Move down
                            </DropdownMenuItem>
                          )}
                          {!plan.isDefault && (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => open('delete', plan)}
                            >
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PlanFormDialog
        plan={target}
        open={dialog === 'edit'}
        onOpenChange={(open) => setDialog(open ? 'edit' : null)}
        onSaved={refresh}
      />
      <DeletePlanDialog
        plan={target}
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        onDeleted={refresh}
      />
    </Page>
  )
}
