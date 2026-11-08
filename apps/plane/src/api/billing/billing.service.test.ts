import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createUser } from '../../../test/fixtures'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import { subscription, user } from '../platform/db/schema'
import { env } from '../platform/env'
import { billingService } from './billing.service'
import {
  BillingCancelFailedError,
  CheckoutsNotExpiredError,
  NotACustomerError,
  NotSubscribedError,
  PaymentOverdueError,
  PlanInUseError,
  PlanPriceTakenError,
  PlanUnavailableError,
} from './errors'
import { limitsService } from './limits'
import { plansService } from './plans.service'
import { stripeApi } from './stripe'

const saved = { stripe: env.stripe, client: stripeApi.client }
beforeAll(() => {
  env.stripe = { apiKey: 'sk_test', webhookSecret: 'whsec_test' }
})
afterAll(async () => {
  await plansService.limitsApplied()
  env.stripe = saved.stripe
  stripeApi.client = saved.client
})

const missing = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: 'invalid_request_error',
    code: 'resource_missing',
    message: 'No such subscription',
  })

type Session = {
  id: string
  status: 'open' | 'complete' | 'expired'
  metadata: { subscriptionId: string }
  subscription: string | null
  // The price it's checking out.
  price?: string
}

// A Stripe client answering only what's asked of it here: `listed` are the
// customer's subscriptions as Stripe has them, `sessions` their checkouts.
const fakeStripe = ({
  retrieve = async () => ({}),
  cancel,
  listed = [],
  sessions = [],
  expire,
}: {
  retrieve?: (id: string) => Promise<unknown>
  cancel?: (id: string) => Promise<unknown>
  listed?: { id: string; status: string }[]
  sessions?: Session[]
  expire?: (id: string) => Promise<unknown>
}) => {
  const cancelled: string[] = []
  const expired: string[] = []
  stripeApi.client = {
    subscriptions: {
      retrieve,
      list: async function* () {
        yield* listed
      },
      cancel:
        cancel ??
        (async (id: string) => {
          cancelled.push(id)
          return {}
        }),
    },
    checkout: {
      sessions: {
        list: async function* ({ status }: { status?: string }) {
          yield* sessions.filter(
            (session) => !status || session.status === status,
          )
        },
        expire:
          expire ??
          (async (id: string) => {
            expired.push(id)
            return {}
          }),
        listLineItems: async (id: string) => ({
          data: [
            {
              price: {
                id: sessions.find((session) => session.id === id)?.price,
              },
            },
          ],
        }),
      },
    },
  } as unknown as Stripe
  return { cancelled, expired }
}

const remote = (status: string, priceId: string) => ({
  status,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  ended_at: null,
  items: {
    data: [
      {
        price: { id: priceId, recurring: { interval: 'month' } },
        current_period_start: 1_800_000_000,
        current_period_end: 1_802_592_000,
      },
    ],
  },
})

const subscribed = async (status = 'active') => {
  const userId = await createUser()
  await organizationsService.createPersonal(userId)
  const paid = await plansService.create({
    name: `plan-${crypto.randomUUID()}`,
    monthlyPriceId: `price_${crypto.randomUUID()}`,
    maxAgents: 5,
  })
  if (paid instanceof Error) throw paid
  const id = crypto.randomUUID()
  const stripeSubscriptionId = `sub_${id}`
  await db.insert(subscription).values({
    id,
    plan: paid.id,
    referenceId: userId,
    stripeSubscriptionId,
    status,
    periodStart: new Date(),
  })
  return { userId, plan: paid, id, stripeSubscriptionId }
}

const statusOf = async (id: string) =>
  (
    await db
      .select({ status: subscription.status })
      .from(subscription)
      .where(eq(subscription.id, id))
  )[0]?.status

describe('syncFromStripe', () => {
  test("applies a cancellation whose webhook wasn't", async () => {
    const { userId, plan, id } = await subscribed()
    fakeStripe({
      retrieve: async () => remote('canceled', plan.monthlyPriceId as string),
    })

    await billingService.syncFromStripe()

    expect(await statusOf(id)).toBe('canceled')
    expect((await limitsService.planFor(userId))?.isDefault).toBe(true)
  })

  test('marks a subscription Stripe no longer has as canceled', async () => {
    const { id } = await subscribed()
    fakeStripe({
      retrieve: async () => {
        throw missing()
      },
    })
    await billingService.syncFromStripe()
    expect(await statusOf(id)).toBe('canceled')
  })
})

describe('cancelAll', () => {
  test('cancels every live subscription Stripe has, and expires open checkouts', async () => {
    const { userId, id, stripeSubscriptionId } = await subscribed()
    await db
      .update(user)
      .set({ stripeCustomerId: `cus_${userId}` })
      .where(eq(user.id, userId))
    const calls = fakeStripe({
      listed: [
        { id: stripeSubscriptionId, status: 'active' },
        // Paid, but its webhook never reached plane.
        { id: 'sub_unheard', status: 'active' },
        { id: 'sub_over', status: 'canceled' },
      ],
      sessions: [
        {
          id: 'cs_open',
          status: 'open',
          metadata: { subscriptionId: 'x' },
          subscription: null,
        },
      ],
    })

    await billingService.cancelAll(userId)

    expect(calls.cancelled).toEqual([stripeSubscriptionId, 'sub_unheard'])
    expect(calls.expired).toEqual(['cs_open'])
    expect(await statusOf(id)).toBe('canceled')
  })

  test('refuses with billing off while they may still be billed', async () => {
    const { userId, id } = await subscribed()
    stripeApi.client = undefined
    await expect(billingService.cancelAll(userId)).rejects.toBeInstanceOf(
      BillingCancelFailedError,
    )
    expect(await statusOf(id)).toBe('active')
  })

  test("refuses when Stripe can't cancel, leaving the subscription", async () => {
    const { userId, id, stripeSubscriptionId } = await subscribed()
    await db
      .update(user)
      .set({ stripeCustomerId: `cus_${userId}` })
      .where(eq(user.id, userId))
    fakeStripe({
      listed: [{ id: stripeSubscriptionId, status: 'active' }],
      cancel: async () => {
        throw new Error('Stripe is down')
      },
    })
    await expect(billingService.cancelAll(userId)).rejects.toBeInstanceOf(
      BillingCancelFailedError,
    )
    expect(await statusOf(id)).toBe('active')
  })
})

test('a plan being checked out stays', async () => {
  const { plan } = await subscribed('incomplete')
  expect(await plansService.delete(plan.id)).toBeInstanceOf(PlanInUseError)
})

describe('checkouts', () => {
  const checkingOut = async () => {
    const { userId, plan, id } = await subscribed('incomplete')
    await db
      .update(subscription)
      .set({ stripeSubscriptionId: null })
      .where(eq(subscription.id, id))
    await db
      .update(user)
      .set({ stripeCustomerId: `cus_${userId}` })
      .where(eq(user.id, userId))
    return { plan, id }
  }
  const session = (
    subscriptionId: string,
    status: Session['status'],
    paid: string | null = null,
    price?: string | null,
  ): Session => ({
    id: `cs_${crypto.randomUUID()}`,
    status,
    metadata: { subscriptionId },
    subscription: paid,
    price: price ?? undefined,
  })

  test('an open one holds its plan', async () => {
    const { plan, id } = await checkingOut()
    fakeStripe({ sessions: [session(id, 'open', null, plan.monthlyPriceId)] })
    expect(await plansService.delete(plan.id)).toBeInstanceOf(PlanInUseError)
  })

  test('an expired one lets its plan go', async () => {
    const { plan, id } = await checkingOut()
    fakeStripe({ sessions: [session(id, 'expired')] })
    expect(await plansService.delete(plan.id)).toBeUndefined()
    expect(await statusOf(id)).toBe('incomplete_expired')
  })

  test('disabling its plan closes an open one', async () => {
    const { plan, id } = await checkingOut()
    const open = session(id, 'open')
    const calls = fakeStripe({ sessions: [open] })

    const updated = await plansService.update(plan.id, { enabled: false })

    expect(updated).not.toBeInstanceOf(Error)
    expect(calls.expired).toEqual([open.id])
    expect(await statusOf(id)).toBe('incomplete_expired')
  })

  test('editing its limits leaves an open one be', async () => {
    const { plan, id } = await checkingOut()
    const calls = fakeStripe({
      sessions: [session(id, 'open', null, plan.monthlyPriceId)],
    })
    await plansService.update(plan.id, {
      maxAgents: 9,
      monthlyPriceId: plan.monthlyPriceId,
    })
    expect(calls.expired).toEqual([])
    expect(await statusOf(id)).toBe('incomplete')
  })

  test('changing its price closes one at the old price, retried on saving again', async () => {
    const { plan, id } = await checkingOut()
    const open = session(id, 'open', null, plan.monthlyPriceId)
    let failing = true
    const calls = fakeStripe({
      sessions: [open],
      expire: async () => {
        if (failing) throw new Error('Stripe is down')
        calls.expired.push(open.id)
        return {}
      },
    })
    const changed = { monthlyPriceId: `price_${crypto.randomUUID()}` }

    expect(await plansService.update(plan.id, changed)).toBeInstanceOf(
      CheckoutsNotExpiredError,
    )
    failing = false
    expect(await plansService.update(plan.id, changed)).not.toBeInstanceOf(
      Error,
    )
    expect(calls.expired).toEqual([open.id])
  })

  test('the sync closes one for a plan disabled while billing was off', async () => {
    const { plan: offered, id } = await checkingOut()
    stripeApi.client = undefined
    await plansService.update(offered.id, { enabled: false })
    const open = session(id, 'open', null, offered.monthlyPriceId)
    const calls = fakeStripe({ sessions: [open] })

    await billingService.syncFromStripe()

    expect(calls.expired).toEqual([open.id])
    expect(await statusOf(id)).toBe('incomplete_expired')
  })

  test('with billing off, they hold their plan', async () => {
    const { plan, id } = await checkingOut()
    stripeApi.client = undefined
    expect(await plansService.delete(plan.id)).toBeInstanceOf(PlanInUseError)
    expect(await statusOf(id)).toBe('incomplete')
  })

  test('a paid one whose webhook was missed is recovered', async () => {
    const { plan, id } = await checkingOut()
    fakeStripe({
      sessions: [session(id, 'complete', 'sub_paid')],
      retrieve: async () => remote('active', plan.monthlyPriceId as string),
    })

    await billingService.syncFromStripe()

    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, id))
    expect(row).toMatchObject({
      stripeSubscriptionId: 'sub_paid',
      status: 'active',
    })
    expect(await plansService.delete(plan.id)).toBeInstanceOf(PlanInUseError)
  })
})

describe('portalUrl', () => {
  test('opens a portal where plans can be paid and cancelled, not switched', async () => {
    const { userId } = await subscribed()
    await db
      .update(user)
      .set({ stripeCustomerId: `cus_${userId}` })
      .where(eq(user.id, userId))
    const created: unknown[] = []
    const sessions: { configuration?: string }[] = []
    stripeApi.client = {
      billingPortal: {
        configurations: {
          list: async function* () {},
          create: async (params: unknown) => {
            created.push(params)
            return { id: 'bpc_plane' }
          },
        },
        sessions: {
          create: async (params: { configuration?: string }) => {
            sessions.push(params)
            return { url: 'https://billing.stripe.com/p/session' }
          },
        },
      },
    } as unknown as Stripe

    expect(await billingService.portalUrl(userId)).toEqual({
      url: 'https://billing.stripe.com/p/session',
    })
    await billingService.portalUrl(userId)

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      features: { subscription_update: { enabled: false } },
    })
    expect(sessions.map((session) => session.configuration)).toEqual([
      'bpc_plane',
      'bpc_plane',
    ])
  })

  test('refuses users who never went to checkout', async () => {
    const userId = await createUser()
    expect(await billingService.portalUrl(userId)).toBeInstanceOf(
      NotACustomerError,
    )
  })
})

describe('changePlan', () => {
  test("switches the subscription's price at once, and its limits", async () => {
    const { userId, plan: from, id, stripeSubscriptionId } = await subscribed()
    const to = await plansService.create({
      name: `plan-${crypto.randomUUID()}`,
      monthlyPriceId: `price_${crypto.randomUUID()}`,
      yearlyPriceId: `price_${crypto.randomUUID()}`,
      maxAgents: 1,
    })
    if (to instanceof Error) throw to
    const updates: unknown[] = []
    fakeStripe({
      retrieve: async () => ({
        status: 'active',
        items: {
          data: [{ id: 'si_1', price: { id: from.monthlyPriceId } }],
        },
      }),
    })
    ;(
      stripeApi.client as unknown as {
        subscriptions: { update: (id: string, params: unknown) => unknown }
      }
    ).subscriptions.update = async (subscriptionId, params) => {
      updates.push({ subscriptionId, params })
      return {}
    }

    expect(await billingService.changePlan(userId, to.id, true)).toBeUndefined()

    expect(updates).toEqual([
      {
        subscriptionId: stripeSubscriptionId,
        params: {
          items: [{ id: 'si_1', price: to.yearlyPriceId }],
          proration_behavior: 'create_prorations',
        },
      },
    ])
    const [row] = await db
      .select()
      .from(subscription)
      .where(eq(subscription.id, id))
    expect(row).toMatchObject({ plan: to.id, billingInterval: 'year' })
    expect((await limitsService.limitsFor(userId)).agents).toBe(1)
  })

  test('refuses while Stripe says payment is overdue, catching up', async () => {
    const { userId, id } = await subscribed()
    const to = await plansService.create({
      name: `plan-${crypto.randomUUID()}`,
      monthlyPriceId: `price_${crypto.randomUUID()}`,
    })
    if (to instanceof Error) throw to
    fakeStripe({
      retrieve: async () => ({ status: 'past_due', items: { data: [] } }),
    })
    expect(
      await billingService.changePlan(userId, to.id, false),
    ).toBeInstanceOf(PaymentOverdueError)
    expect(await statusOf(id)).toBe('past_due')
  })

  test('refuses plans not on offer, and users without a subscription', async () => {
    const { userId, plan: current } = await subscribed()
    fakeStripe({})
    const monthlyOnly = await plansService.create({
      name: `plan-${crypto.randomUUID()}`,
      monthlyPriceId: `price_${crypto.randomUUID()}`,
    })
    if (monthlyOnly instanceof Error) throw monthlyOnly
    expect(
      await billingService.changePlan(userId, monthlyOnly.id, true),
    ).toBeInstanceOf(PlanUnavailableError)
    await plansService.update(monthlyOnly.id, { enabled: false })
    expect(
      await billingService.changePlan(userId, monthlyOnly.id, false),
    ).toBeInstanceOf(PlanUnavailableError)

    const newcomer = await createUser()
    expect(
      await billingService.changePlan(newcomer, current.id, false),
    ).toBeInstanceOf(NotSubscribedError)
  })
})

describe('prices', () => {
  test('stay with their plan once replaced, and keep its subscribers on it', async () => {
    const { userId, plan: original, id } = await subscribed()
    const oldPrice = original.monthlyPriceId as string
    const replaced = await plansService.update(original.id, {
      monthlyPriceId: `price_${crypto.randomUUID()}`,
    })
    expect(replaced).not.toBeInstanceOf(Error)

    const other = await plansService.create({
      name: `plan-${crypto.randomUUID()}`,
      monthlyPriceId: oldPrice,
    })
    expect(other).toBeInstanceOf(PlanPriceTakenError)

    fakeStripe({ retrieve: async () => remote('active', oldPrice) })
    await billingService.syncFromStripe()
    const [row] = await db
      .select({ plan: subscription.plan })
      .from(subscription)
      .where(eq(subscription.id, id))
    expect(row?.plan).toBe(original.id)
    expect((await limitsService.planFor(userId))?.id).toBe(original.id)

    const forStripe = await plansService.forStripe()
    expect(forStripe.filter((found) => found.name === original.id)).toEqual([
      expect.objectContaining({
        priceId: (replaced as { monthlyPriceId: string }).monthlyPriceId,
      }),
      { name: original.id, priceId: oldPrice },
    ])
  })
})

test("plans on offer show their prices' amounts, fetched once", async () => {
  const monthly = `price_${crypto.randomUUID()}`
  const yearly = `price_${crypto.randomUUID()}`
  const offered = await plansService.create({
    name: `plan-${crypto.randomUUID()}`,
    monthlyPriceId: monthly,
    yearlyPriceId: yearly,
    enabled: true,
  })
  if (offered instanceof Error) throw offered
  const fetched: string[] = []
  fakeStripe({})
  ;(stripeApi.client as unknown as Record<string, unknown>).prices = {
    retrieve: async (id: string) => {
      fetched.push(id)
      if (id === yearly) throw new Error('Stripe is down')
      return { unit_amount: 1200, currency: 'eur' }
    },
  }
  const userId = await createUser()
  const shown = async () => {
    const summary = await billingService.summary(userId)
    if (!summary.enabled) throw new Error('billing is off')
    return summary.plans.find((found) => found.id === offered.id)?.prices
  }

  expect(await shown()).toEqual({
    monthly: { amount: 1200, currency: 'eur' },
    yearly: null,
  })
  await shown()
  // The amount is kept; the failed fetch is retried.
  expect(fetched.filter((id) => id === monthly)).toHaveLength(1)
  expect(fetched.filter((id) => id === yearly)).toHaveLength(2)
})

test('a subscription Stripe has but plane missed counts as subscribed', async () => {
  const userId = await createUser()
  await db
    .update(user)
    .set({ stripeCustomerId: `cus_${userId}` })
    .where(eq(user.id, userId))
  fakeStripe({ listed: [{ id: 'sub_missed', status: 'active' }] })
  expect(await billingService.subscribedInStripe(userId)).toBe(true)
  fakeStripe({ listed: [{ id: 'sub_old', status: 'canceled' }] })
  expect(await billingService.subscribedInStripe(userId)).toBe(false)
})

test("a deleted plan's prices stay reserved", async () => {
  const gone = await plansService.create({
    name: `plan-${crypto.randomUUID()}`,
    monthlyPriceId: `price_${crypto.randomUUID()}`,
  })
  if (gone instanceof Error) throw gone
  fakeStripe({})
  expect(await plansService.delete(gone.id)).toBeUndefined()
  expect(
    await plansService.create({
      name: `plan-${crypto.randomUUID()}`,
      monthlyPriceId: gone.monthlyPriceId,
    }),
  ).toBeInstanceOf(PlanPriceTakenError)
})
