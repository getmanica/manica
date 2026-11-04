import type { StripePlan } from '@better-auth/stripe'
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  max,
  not,
  notInArray,
} from 'drizzle-orm'
import { db, type Transaction } from '../platform/db'
import { isCheckViolation, isUniqueViolation } from '../platform/db/errors'
import { plan, planPrice, subscription, user } from '../platform/db/schema'
import { env } from '../platform/env'
import {
  CheckoutsNotExpiredError,
  DefaultPlanRequiredError,
  PlanInUseError,
  PlanNameTakenError,
  PlanNotFoundError,
  PlanOrderInvalidError,
  PlanPricesInvalidError,
  PlanPriceTakenError,
} from './errors'
import { limitsService, type Plan } from './limits'
import { stripeApi } from './stripe'

export type PlanInput = {
  name: string
  description?: string
  monthlyPriceId?: string | null
  yearlyPriceId?: string | null
  enabled?: boolean
  maxOrganizations?: number | null
  maxAgents?: number | null
  maxForgeApps?: number | null
}

// Records the plan's prices as its own, for good; a price another plan
// had, even replaced since, is refused (rolling the write back): its
// subscribers would move to this plan.
const claimPrices = async (tx: Transaction, saved: Plan) => {
  for (const priceId of [saved.monthlyPriceId, saved.yearlyPriceId]) {
    if (!priceId) continue
    await tx
      .insert(planPrice)
      .values({ priceId, planId: saved.id })
      .onConflictDoNothing()
    const [owner] = await tx
      .select({ planId: planPrice.planId })
      .from(planPrice)
      .where(eq(planPrice.priceId, priceId))
    if (owner?.planId !== saved.id) throw new PlanPriceTakenError()
  }
}

// A write's constraint violation, as the plan error it stands for.
const planWriteError = (error: unknown) => {
  if (error instanceof PlanPriceTakenError) return error
  if (isUniqueViolation(error, 'plan_name_unique')) {
    return new PlanNameTakenError()
  }
  if (
    isUniqueViolation(error, 'plan_monthly_price_id_unique') ||
    isUniqueViolation(error, 'plan_yearly_price_id_unique')
  ) {
    return new PlanPriceTakenError()
  }
  if (isCheckViolation(error, 'plan_prices'))
    return new PlanPricesInvalidError()
  return undefined
}

// Blank price ids are no price.
const prices = (input: Partial<PlanInput>) => ({
  ...(input.monthlyPriceId !== undefined && {
    monthlyPriceId: input.monthlyPriceId?.trim() || null,
  }),
  ...(input.yearlyPriceId !== undefined && {
    yearlyPriceId: input.yearlyPriceId?.trim() || null,
  }),
})

// What a plan allows changed: applied to its users at once, in the
// background (the periodic pass catches up if it fails). The latest run is
// kept, for tests to wait on.
let applying: Promise<void> = Promise.resolve()
const applyLimits = () => {
  if (!env.stripe) return
  applying = limitsService.reconcileAll().catch((error: unknown) => {
    console.error('reconciling plan limits failed:', error)
  })
}

// Subscriptions that are over for good.
const finishedStatuses = ['canceled', 'incomplete_expired'] as const

const applied = <Result>(result: Result) => {
  if (!(result instanceof Error)) applyLimits()
  return result
}

// Expected failures are returned rather than thrown (see `agents.service`).
export const plansService = {
  // Every plan, the default first, then in their order.
  list: () =>
    db
      .select()
      .from(plan)
      .orderBy(desc(plan.isDefault), asc(plan.position), asc(plan.name)),

  // The plans users can pick, in their order: enabled, and priced, so not
  // the default.
  available: () =>
    db
      .select()
      .from(plan)
      .where(and(eq(plan.enabled, true), isNotNull(plan.monthlyPriceId)))
      .orderBy(asc(plan.position), asc(plan.name)),

  // Puts the paid plans in the order given, which must be all of them (the
  // default plan always comes first). Resolves to nothing once saved.
  reorder: (ids: string[]) =>
    db.transaction(async (tx) => {
      const paid = await tx
        .select({ id: plan.id })
        .from(plan)
        .where(not(plan.isDefault))
        .for('update')
      if (
        ids.length !== paid.length ||
        new Set(ids).size !== ids.length ||
        !paid.every(({ id }) => ids.includes(id))
      ) {
        return new PlanOrderInvalidError()
      }
      for (const [position, id] of ids.entries()) {
        await tx.update(plan).set({ position }).where(eq(plan.id, id))
      }
    }),

  // The plans as the Stripe plugin knows them, by id so renaming one keeps
  // its subscriptions: all priced ones, disabled too, so their subscribers'
  // webhooks still resolve to them. Subscribing to a disabled one is refused
  // before it reaches the plugin (see `auth/better-auth.ts`).
  // A plan's replaced prices follow its current ones, under the same name:
  // the plugin subscribes to the first plan of a name, and recognizes
  // subscriptions on any of them.
  async forStripe(): Promise<StripePlan[]> {
    const [plans, prices] = await Promise.all([
      db.select().from(plan).where(isNotNull(plan.monthlyPriceId)),
      db.select().from(planPrice),
    ])
    const current = plans.map((found) => ({
      name: found.id,
      priceId: found.monthlyPriceId ?? undefined,
      annualDiscountPriceId: found.yearlyPriceId ?? undefined,
    }))
    const replaced = prices
      .filter(({ planId, priceId }) =>
        plans.some(
          (found) =>
            found.id === planId &&
            found.monthlyPriceId !== priceId &&
            found.yearlyPriceId !== priceId,
        ),
      )
      .flatMap(({ planId, priceId }) =>
        planId ? [{ name: planId, priceId }] : [],
      )
    return [...current, ...replaced]
  },

  // Resolves once the limits of the last plan change are applied.
  limitsApplied: () => applying,

  // Which plan each Stripe price is, or was, a price of.
  async priceOwners() {
    const prices = await db.select().from(planPrice)
    return new Map(
      prices.flatMap(({ priceId, planId }) =>
        planId ? [[priceId, planId] as const] : [],
      ),
    )
  },

  // A paid plan, shown last: the default one is seeded, and stays the
  // default (its limits can be edited). Nobody is on it yet, so no limits
  // change.
  create: (input: PlanInput) =>
    db
      .transaction(async (tx) => {
        const [last] = await tx
          .select({ position: max(plan.position) })
          .from(plan)
        const [created] = await tx
          .insert(plan)
          .values({
            ...input,
            ...prices(input),
            id: crypto.randomUUID(),
            name: input.name.trim(),
            position: (last?.position ?? -1) + 1,
          })
          .returning()
        if (!created) throw new Error('Failed to insert plan')
        await claimPrices(tx, created)
        return created
      })
      .catch((error: unknown) => {
        const known = planWriteError(error)
        if (known) return known
        throw error
      }),

  // Changed limits apply at once. Checkouts still open for what the plan no
  // longer offers (it's disabled, or at a price it no longer has) are
  // closed: paying one would subscribe to what's not on offer. Saving again
  // retries closing them.
  update: async (id: string, changes: Partial<PlanInput>) => {
    const updated = await db
      .transaction(async (tx) => {
        const [found] = await tx
          .select()
          .from(plan)
          .where(eq(plan.id, id))
          .for('update')
        if (!found) return new PlanNotFoundError()
        const [updated] = await tx
          .update(plan)
          .set({
            ...changes,
            ...prices(changes),
            ...(changes.name !== undefined && { name: changes.name.trim() }),
          })
          .where(eq(plan.id, id))
          .returning()
        if (updated) await claimPrices(tx, updated)
        return updated ?? new PlanNotFoundError()
      })
      .catch((error: unknown) => {
        const known = planWriteError(error)
        if (known) return known
        throw error
      })
      .then(applied)
    if (updated instanceof Error) return updated
    try {
      await plansService.releaseAbandonedCheckouts(id)
    } catch (error) {
      console.error(`expiring plan ${id}'s checkouts failed:`, error)
      return new CheckoutsNotExpiredError()
    }
    return updated
  },

  // Settles the subscriptions started for a checkout, from what became of
  // it: paid, it's linked to the Stripe subscription it started (then synced,
  // see `billing.service`), whether or not its webhook was heard; expired or
  // never opened, it's over, and no longer holds its plan. With billing off,
  // checkouts can't be looked at, so they're left as they are. Open
  // checkouts for what their plan no longer offers (it's disabled, gone, or
  // at a price it no longer has) are closed: paying one would subscribe to
  // what's not on offer.
  async releaseAbandonedCheckouts(planId?: string) {
    const stripe = stripeApi.client
    if (!stripe) return
    const pending = await db
      .select({
        id: subscription.id,
        customerId: user.stripeCustomerId,
        offered: plan,
      })
      .from(subscription)
      .leftJoin(user, eq(user.id, subscription.referenceId))
      .leftJoin(plan, eq(plan.id, subscription.plan))
      .where(
        and(
          eq(subscription.status, 'incomplete'),
          isNull(subscription.stripeSubscriptionId),
          planId ? eq(subscription.plan, planId) : undefined,
        ),
      )
    // Each checkout's state, by the subscription it was started for.
    const checkouts = new Map<
      string,
      { open: string[]; subscription: string | undefined }
    >()
    {
      const customers = new Set(
        pending.flatMap(({ customerId }) => (customerId ? [customerId] : [])),
      )
      for (const customer of customers) {
        for await (const session of stripe.checkout.sessions.list({
          customer,
        })) {
          const id = session.metadata?.subscriptionId
          if (!id) continue
          const paid =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription?.id
          const known = checkouts.get(id)
          checkouts.set(id, {
            open: [
              ...(known?.open ?? []).filter((open) => open !== session.id),
              ...(session.status === 'open' ? [session.id] : []),
            ],
            subscription: known?.subscription ?? paid,
          })
        }
      }
    }
    for (const { id, offered } of pending) {
      const checkout = checkouts.get(id)
      if (checkout?.open.length && !checkout.subscription) {
        const prices = offered?.enabled
          ? [offered.monthlyPriceId, offered.yearlyPriceId].filter(Boolean)
          : []
        const kept: string[] = []
        for (const session of checkout.open) {
          const items = await stripe.checkout.sessions.listLineItems(session)
          if (
            items.data.every((item) => prices.includes(item.price?.id ?? null))
          ) {
            kept.push(session)
          } else {
            await stripe.checkout.sessions.expire(session)
          }
        }
        checkout.open = kept
      }
      if (checkout?.subscription) {
        await db
          .update(subscription)
          .set({ stripeSubscriptionId: checkout.subscription })
          .where(
            and(
              eq(subscription.id, id),
              isNull(subscription.stripeSubscriptionId),
            ),
          )
      } else if (!checkout?.open.length) {
        await db
          .update(subscription)
          .set({ status: 'incomplete_expired' })
          .where(
            and(
              eq(subscription.id, id),
              isNull(subscription.stripeSubscriptionId),
            ),
          )
      }
    }
  },

  // Refused for the default plan, and for plans a subscription that isn't
  // over refers to: one being checked out too, or paying for it would
  // subscribe to a plan the plugin no longer knows. Resolves to nothing once
  // deleted.
  delete: async (id: string) => {
    await plansService.releaseAbandonedCheckouts(id)
    return db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(plan)
        .where(eq(plan.id, id))
        .for('update')
      if (!found) return new PlanNotFoundError()
      if (found.isDefault) return new DefaultPlanRequiredError()
      const [held] = await tx
        .select({ id: subscription.id })
        .from(subscription)
        .where(
          and(
            eq(subscription.plan, id),
            notInArray(subscription.status, [...finishedStatuses]),
          ),
        )
        .limit(1)
      if (held) return new PlanInUseError()
      await tx.delete(plan).where(eq(plan.id, id))
    })
  },
}
