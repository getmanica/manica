import type { Treaty } from '@elysia/eden'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export type Billing = Treaty.Data<(typeof api)['billing']['get']>
export type EnabledBilling = Extract<Billing, { enabled: true }>
export type BillingPlan = EnabledBilling['plans'][number]
export type Limit = keyof EnabledBilling['usage']

export const billingKey = ['billing']

// The user's plan, usage and the plans on offer; `enabled: false` when the
// plane has no billing, which then hides it from the console.
export const billingQuery = queryOptions({
  queryKey: billingKey,
  queryFn: ({ signal }) => api.billing.get({ fetch: { signal } }).then(unwrap),
  staleTime: 60_000,
})

export const limitLabels: Record<Limit, string> = {
  organizations: 'Organizations',
  agents: 'Agents',
  forgeApps: 'Forge apps',
}

export const formatLimit = (max: number | null) =>
  max === null ? 'Unlimited' : String(max)

// A Stripe amount, in its currency's smallest unit, as money: "€12" or
// "$9.99". Undefined when the price isn't a flat amount, or couldn't be
// fetched.
export const formatPrice = (price: BillingPlan['prices']['monthly']) => {
  if (price?.amount == null) return undefined
  const format = (digits?: number) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: price.currency.toUpperCase(),
      minimumFractionDigits: digits,
    })
  const { maximumFractionDigits = 2 } = format().resolvedOptions()
  const value = price.amount / 10 ** maximumFractionDigits
  // Whole amounts without the cents.
  return format(Number.isInteger(value) ? 0 : undefined).format(value)
}
