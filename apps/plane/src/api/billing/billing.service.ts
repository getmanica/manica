import { and, desc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm'
import Stripe from 'stripe'
import { db } from '../platform/db'
import { subscription, user } from '../platform/db/schema'
import { env } from '../platform/env'
import {
  BillingCancelFailedError,
  NotACustomerError,
  NotSubscribedError,
  PaymentOverdueError,
  PlanUnavailableError,
} from './errors'
import { holdingStatuses, limitsService, type Plan } from './limits'
import { plansService } from './plans.service'
import { stripeApi } from './stripe'

// Subscriptions that are over for good: Stripe won't change them again.
const settledStatuses = ['canceled', 'incomplete_expired'] as const

const missing = (error: unknown) =>
  error instanceof Stripe.errors.StripeError &&
  error.code === 'resource_missing'

// The user's Stripe customer, once they've been to checkout.
const customerOf = async (userId: string) => {
  const [found] = await db
    .select({ stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.id, userId))
  return found?.stripeCustomerId ?? undefined
}

// The customer portal plane sends users to: paying, invoices and
// cancelling, but no switching plans, which goes through plane's checkout
// so disabled plans can't be picked. Created once in the Stripe account,
// found again by its metadata.
const PORTAL_TAG = 'manica-plane'
let portalConfiguration: string | undefined

const portalConfigurationOf = async (stripe: Stripe) => {
  if (portalConfiguration) return portalConfiguration
  for await (const found of stripe.billingPortal.configurations.list({
    active: true,
  })) {
    if (found.metadata?.[PORTAL_TAG]) {
      portalConfiguration = found.id
      return found.id
    }
  }
  const created = await stripe.billingPortal.configurations.create({
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: {
        enabled: true,
        allowed_updates: ['email', 'address', 'tax_id'],
      },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
    metadata: { [PORTAL_TAG]: 'true' },
  })
  portalConfiguration = created.id
  return created.id
}

const fromUnix = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000) : null

// What a price costs, as Stripe has it: `amount` in the currency's smallest
// unit, null for prices that aren't a flat amount (tiered, metered, or
// customer-chosen). Stripe never changes a price's amount, it makes a new
// price, so each is fetched once; a failed fetch is retried next time, and
// the plan is shown without it meanwhile.
export type PriceAmount = { amount: number | null; currency: string }
const amounts = new Map<string, Promise<PriceAmount | null>>()

const amountOf = (priceId: string | null) => {
  const stripe = stripeApi.client
  if (!priceId || !stripe) return Promise.resolve(null)
  let found = amounts.get(priceId)
  if (!found) {
    found = stripe.prices.retrieve(priceId).then(
      (price) => ({ amount: price.unit_amount, currency: price.currency }),
      (error: unknown) => {
        amounts.delete(priceId)
        console.error(`fetching price ${priceId} failed:`, error)
        return null
      },
    )
    amounts.set(priceId, found)
  }
  return found
}

// A plan as users see it: what it costs, but no Stripe ids.
const publicPlan = async (found: Plan) => {
  const [monthlyPrice, yearlyPrice] = await Promise.all([
    amountOf(found.monthlyPriceId),
    amountOf(found.yearlyPriceId),
  ])
  return {
    id: found.id,
    name: found.name,
    description: found.description,
    monthly: !!found.monthlyPriceId,
    yearly: !!found.yearlyPriceId,
    prices: { monthly: monthlyPrice, yearly: yearlyPrice },
    limits: {
      organizations: found.maxOrganizations,
      agents: found.maxAgents,
      forgeApps: found.maxForgeApps,
    },
  }
}

export const billingService = {
  // The user's billing: the plan they're on, what they use of it, the
  // subscription that gives it them, the plans they can switch to, and
  // which of their organizations, agents and forge apps are disabled for
  // being past it. `portal` is whether they're a Stripe customer, who can
  // manage payment and invoices whatever their subscription's state.
  async summary(userId: string) {
    if (!env.stripe) return { enabled: false as const }
    const [current, usage, plans, resources, [subscribed], [customer]] =
      await Promise.all([
        limitsService.planFor(userId),
        limitsService.usage(userId),
        plansService.available(),
        limitsService.resources(userId),
        db
          .select({
            plan: subscription.plan,
            status: subscription.status,
            billingInterval: subscription.billingInterval,
            periodEnd: subscription.periodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            cancelAt: subscription.cancelAt,
          })
          .from(subscription)
          .where(
            and(
              eq(subscription.referenceId, userId),
              inArray(subscription.status, [...holdingStatuses]),
            ),
          )
          .orderBy(desc(subscription.periodStart))
          .limit(1),
        db
          .select({ stripeCustomerId: user.stripeCustomerId })
          .from(user)
          .where(eq(user.id, userId)),
      ])
    return {
      enabled: true as const,
      plan: current ? await publicPlan(current) : null,
      subscription: subscribed ?? null,
      portal: !!customer?.stripeCustomerId,
      usage,
      plans: await Promise.all(plans.map(publicPlan)),
      resources,
    }
  },

  // Expires the checkouts the user left open: starting another, or leaving
  // for good, would otherwise leave them payable, each a subscription of its
  // own.
  async expireOpenCheckouts(userId: string) {
    const stripe = stripeApi.client
    if (!stripe) return
    const customerId = await customerOf(userId)
    if (!customerId) return
    for await (const session of stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
    })) {
      await stripe.checkout.sessions.expire(session.id)
    }
  },

  // Stops billing the user, before their account goes: expires the
  // checkouts they left open and cancels, at once, every subscription Stripe
  // has for them, whether or not plane heard of it. Throws if Stripe can't be
  // reached, or billing was turned off while they may still be billed, so
  // the deletion is refused and can be retried.
  async cancelAll(userId: string) {
    const stripe = stripeApi.client
    if (!stripe) {
      // Billing was turned off since: what Stripe still bills them for can't
      // be cancelled, so they stay until it's back on.
      const [billed] = await db
        .select({ id: subscription.id })
        .from(subscription)
        .where(
          and(
            eq(subscription.referenceId, userId),
            notInArray(subscription.status, [...settledStatuses]),
          ),
        )
        .limit(1)
      if (billed) {
        throw new BillingCancelFailedError(
          'This user may still be billed by Stripe, but billing is off on this plane: turn it back on so their subscription can be cancelled first',
        )
      }
      return
    }
    try {
      const customerId = await customerOf(userId)
      if (customerId) {
        await this.expireOpenCheckouts(userId)
        for await (const remote of stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
        })) {
          if ((settledStatuses as readonly string[]).includes(remote.status)) {
            continue
          }
          try {
            await stripe.subscriptions.cancel(remote.id)
          } catch (error) {
            if (!missing(error)) throw error
          }
        }
      }
      await db
        .update(subscription)
        .set({ status: 'canceled', endedAt: new Date() })
        .where(
          and(
            eq(subscription.referenceId, userId),
            notInArray(subscription.status, [...settledStatuses]),
          ),
        )
    } catch (error) {
      console.error(`cancelling ${userId}'s subscriptions failed:`, error)
      throw new BillingCancelFailedError()
    }
  },

  // Brings the subscriptions Stripe may still change up to date from it, and
  // the limits of their users with them: webhooks the plugin failed to
  // apply are otherwise lost (it acknowledges them all). Settles abandoned
  // checkouts too.
  async syncFromStripe() {
    const stripe = stripeApi.client
    if (!stripe) return
    // First, so the subscriptions of checkouts completed unheard of are
    // synced along.
    await plansService.releaseAbandonedCheckouts()
    // By every price each plan had: subscribers keep the one they paid.
    const owners = await plansService.priceOwners()
    const planOf = (priceId: string) => owners.get(priceId)
    const rows = await db
      .select()
      .from(subscription)
      .where(
        and(
          isNotNull(subscription.stripeSubscriptionId),
          notInArray(subscription.status, [...settledStatuses]),
        ),
      )
    const changed = new Set<string>()
    for (const row of rows) {
      try {
        const remote = await stripe.subscriptions.retrieve(
          row.stripeSubscriptionId as string,
        )
        const item =
          remote.items.data.find((found) => planOf(found.price.id)) ??
          remote.items.data[0]
        const next = {
          status: remote.status,
          plan: (item && planOf(item.price.id)) ?? row.plan,
          periodStart: fromUnix(item?.current_period_start) ?? row.periodStart,
          periodEnd: fromUnix(item?.current_period_end) ?? row.periodEnd,
          cancelAtPeriodEnd: remote.cancel_at_period_end,
          cancelAt: fromUnix(remote.cancel_at),
          canceledAt: fromUnix(remote.canceled_at),
          endedAt: fromUnix(remote.ended_at),
          billingInterval:
            item?.price.recurring?.interval ?? row.billingInterval,
        }
        await db
          .update(subscription)
          .set(next)
          .where(eq(subscription.id, row.id))
        if (next.status !== row.status || next.plan !== row.plan) {
          changed.add(row.referenceId)
        }
      } catch (error) {
        if (missing(error)) {
          await db
            .update(subscription)
            .set({ status: 'canceled' })
            .where(eq(subscription.id, row.id))
          changed.add(row.referenceId)
        } else {
          console.error(`syncing subscription ${row.id} failed:`, error)
        }
      }
    }
    for (const userId of changed) await limitsService.reconcile(userId)
  },

  // A Stripe customer portal session for the user, back to the billing page
  // after.
  async portalUrl(userId: string) {
    const stripe = stripeApi.client
    const customerId = await customerOf(userId)
    if (!stripe || !customerId) return new NotACustomerError()
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: await portalConfigurationOf(stripe),
      return_url: `${env.betterAuthUrl}/billing`,
    })
    return { url: session.url }
  },

  // The user's subscription Stripe bills or trials, if any: the one a plan
  // change applies to.
  async liveSubscription(userId: string) {
    const [found] = await db
      .select()
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, userId),
          inArray(subscription.status, ['active', 'trialing']),
          isNotNull(subscription.stripeSubscriptionId),
        ),
      )
      .orderBy(desc(subscription.periodStart))
      .limit(1)
    return found
  },

  // Moves the user's subscription to another plan, or interval, at once,
  // prorated on the next invoice. Done here rather than through Stripe's
  // portal, whose settings would have to list every plan's prices.
  // Subscribing in the first place goes through checkout.
  async changePlan(userId: string, planId: string, annual: boolean) {
    const stripe = stripeApi.client
    if (!stripe) return new PlanUnavailableError()
    const target = (await plansService.available()).find(
      (found) => found.id === planId,
    )
    const priceId = annual ? target?.yearlyPriceId : target?.monthlyPriceId
    if (!target || !priceId) return new PlanUnavailableError()
    const [overdue] = await db
      .select({ id: subscription.id })
      .from(subscription)
      .where(
        and(
          eq(subscription.referenceId, userId),
          inArray(subscription.status, ['past_due', 'unpaid']),
        ),
      )
      .limit(1)
    if (overdue) return new PaymentOverdueError()
    const live = await this.liveSubscription(userId)
    if (!live?.stripeSubscriptionId) return new NotSubscribedError()

    const remote = await stripe.subscriptions.retrieve(
      live.stripeSubscriptionId,
    )
    // Stripe's word on the payment, in case its webhook was missed.
    if (remote.status !== 'active' && remote.status !== 'trialing') {
      await db
        .update(subscription)
        .set({ status: remote.status })
        .where(eq(subscription.id, live.id))
      await limitsService.reconcile(userId)
      return remote.status === 'past_due' || remote.status === 'unpaid'
        ? new PaymentOverdueError()
        : new NotSubscribedError()
    }
    const owners = await plansService.priceOwners()
    const item =
      remote.items.data.find((found) => owners.has(found.price.id)) ??
      remote.items.data[0]
    if (!item) return new NotSubscribedError()
    if (item.price.id !== priceId) {
      await stripe.subscriptions.update(live.stripeSubscriptionId, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'create_prorations',
      })
    }
    // Stripe's webhook says the same; applied now so limits follow at once.
    await db
      .update(subscription)
      .set({ plan: target.id, billingInterval: annual ? 'year' : 'month' })
      .where(eq(subscription.id, live.id))
    await limitsService.reconcile(userId)
  },

  // Whether Stripe bills the user for a subscription already, heard of or
  // not: a paid checkout whose webhook was missed is caught up on (by the
  // sync, started here) rather than paid for twice.
  async subscribedInStripe(userId: string) {
    const stripe = stripeApi.client
    const customerId = await customerOf(userId)
    if (!stripe || !customerId) return false
    for await (const remote of stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
    })) {
      if (!(settledStatuses as readonly string[]).includes(remote.status)) {
        void this.syncFromStripe().catch((error: unknown) => {
          console.error('syncing subscriptions failed:', error)
        })
        return true
      }
    }
    return false
  },
}
