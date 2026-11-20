import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../platform/db'
import { plan, planGrant, subscription } from '../platform/db/schema'
import { env } from '../platform/env'
import { billingService } from './billing.service'
import {
  BillingDisabledError,
  GrantForSubscriberError,
  GrantNotFoundError,
  GrantPlanInvalidError,
  PlanNotFoundError,
} from './errors'
import { grantHolds, holdingStatuses, limitsService } from './limits'

export type GrantInput = {
  planId: string
  // Seconds from now; for good without.
  expiresIn?: number
  reason?: string
}

// Whether the user pays, or owes, for a subscription, as plane or Stripe
// has it (a paid checkout's webhook may not have arrived yet).
const subscribed = async (userId: string) => {
  const [held] = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, userId),
        inArray(subscription.status, [...holdingStatuses, 'unpaid']),
      ),
    )
    .limit(1)
  return !!held || (await billingService.subscribedInStripe(userId))
}

// Plans admins give users for free, in place of the default plan (see
// `planGrant`). Users who pay can't be granted one, and granted users can't
// subscribe (see `auth/better-auth`): a user is on one or the other.
export const grantsService = {
  // The user's grant, while it holds.
  async current(userId: string) {
    const [found] = await db
      .select({
        planId: planGrant.planId,
        planName: plan.name,
        expiresAt: planGrant.expiresAt,
        reason: planGrant.reason,
      })
      .from(planGrant)
      .innerJoin(plan, eq(plan.id, planGrant.planId))
      .where(and(eq(planGrant.userId, userId), grantHolds))
    return found
  },

  // Grants the user the plan, replacing any grant they had, and applies its
  // limits at once. Any plan but the default, disabled ones too: a plan
  // nobody can subscribe to can still be given. Refused while Stripe bills
  // the user, whether or not plane heard of it. Their open checkouts are
  // expired first, so none completes unseen while they're checked, and again
  // once granted, for one opened meanwhile (see `expireCheckoutsIfGranted`
  // for one opened after). One paid in between is caught by checking again
  // after that: the grant is undone.
  async grant(adminId: string, userId: string, input: GrantInput) {
    if (!env.stripe) return new BillingDisabledError()
    const [target] = await db
      .select({ id: plan.id, isDefault: plan.isDefault })
      .from(plan)
      .where(eq(plan.id, input.planId))
    if (!target) return new PlanNotFoundError()
    if (target.isDefault) return new GrantPlanInvalidError()
    await billingService.expireOpenCheckouts(userId)
    if (await subscribed(userId)) return new GrantForSubscriberError()
    const values = {
      planId: target.id,
      expiresAt: input.expiresIn
        ? new Date(Date.now() + input.expiresIn * 1000)
        : null,
      reason: input.reason?.trim() || null,
      grantedBy: adminId,
      createdAt: new Date(),
    }
    // Stored while holding the plan, so deleting it (which locks it too)
    // can't take a grant renewed meanwhile along with the expired ones. The
    // grant it replaces is kept, to put back if granting fails.
    const stored = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: plan.id })
        .from(plan)
        .where(eq(plan.id, target.id))
        .for('share')
      if (!locked) return new PlanNotFoundError()
      const [replaced] = await tx
        .select()
        .from(planGrant)
        .where(eq(planGrant.userId, userId))
        .for('update')
      await tx
        .insert(planGrant)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: planGrant.userId, set: values })
      return { replaced }
    })
    if (stored instanceof Error) return stored
    // Takes back this grant, unless another was stored since: removed if the
    // user pays (their subscription's limits applied), else the one it
    // replaced put back. Its limits were never applied: which of the user's
    // resources are enabled stays as they chose.
    const undo = async (paid: boolean) => {
      const ours = and(
        eq(planGrant.userId, userId),
        eq(planGrant.createdAt, values.createdAt),
      )
      if (stored.replaced && !paid) {
        await db.update(planGrant).set(stored.replaced).where(ours)
      } else {
        await db.delete(planGrant).where(ours)
      }
      if (paid) await limitsService.reconcile(userId)
    }
    try {
      // Throws for a checkout paid as it's expired, or Stripe failing.
      await billingService.expireOpenCheckouts(userId)
      if (await subscribed(userId)) {
        await undo(true)
        return new GrantForSubscriberError()
      }
    } catch (error) {
      await undo(await subscribed(userId).catch(() => false))
      throw error
    }
    await limitsService.reconcile(userId)
    return { userId, planId: target.id, expiresAt: values.expiresAt }
  },

  // Expires the user's open checkouts if they hold a grant: run once a
  // checkout is opened, for one whose request was let through just before
  // the grant landed. Either this sees the grant, or the grant's own expiry
  // pass, run after it's stored, sees the checkout.
  async expireCheckoutsIfGranted(userId: string) {
    if (await this.current(userId)) {
      await billingService.expireOpenCheckouts(userId)
    }
  },

  // Takes the user's grant away, expired or not, back to the default plan.
  async revoke(userId: string) {
    const [found] = await db
      .delete(planGrant)
      .where(eq(planGrant.userId, userId))
      .returning({ userId: planGrant.userId })
    if (!found) return new GrantNotFoundError()
    if (env.stripe) await limitsService.reconcile(userId)
  },
}
