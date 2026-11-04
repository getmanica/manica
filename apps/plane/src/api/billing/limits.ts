import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm'
import { db, type Transaction } from '../platform/db'
import {
  agent,
  forgeApp,
  organization,
  organizationBilling,
  type PlanLimit,
  plan,
  subscription,
} from '../platform/db/schema'
import { env } from '../platform/env'
import {
  OrganizationDisabledError,
  PlanLimitReachedError,
  SwapInvalidError,
} from './errors'

export type Plan = typeof plan.$inferSelect

// Subscriptions that hold their plan: Stripe is still billing them, or
// retrying a failed payment.
export const holdingStatuses = ['active', 'trialing', 'past_due'] as const

// What a user may have, each across the organizations they're the billing
// owner of: a maximum, or null for unlimited.
export type Limits = Record<PlanLimit, number | null>

const unlimited: Limits = { organizations: null, agents: null, forgeApps: null }

const limitsOf = (found: Plan): Limits => ({
  organizations: found.maxOrganizations,
  agents: found.maxAgents,
  forgeApps: found.maxForgeApps,
})

type Db = Transaction | typeof db

// One billing owner's limits are checked and applied one at a time, so two
// creations can't both take the last slot, nor a reconcile miss a creation.
const lockOwner = (tx: Transaction, userId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`billing:${userId}`}))`,
  )

// Organizations disabled for being past their billing owner's plan.
const disabledOrganization = (organizationId: AnyColumn) =>
  exists(
    db
      .select({ id: organizationBilling.organizationId })
      .from(organizationBilling)
      .where(
        and(
          eq(organizationBilling.organizationId, organizationId),
          isNotNull(organizationBilling.disabledAt),
        ),
      ),
  )

// Since when the agent or forge app is disabled, by itself or through its
// organization: what the console shows.
export const disabledSince = (table: typeof agent | typeof forgeApp) =>
  sql<Date | null>`coalesce(${table.disabledAt}, (
    select ${organizationBilling.disabledAt} from ${organizationBilling}
    where ${organizationBilling.organizationId} = ${table.organizationId}
  ))`.mapWith(table.disabledAt)

// Agents handed jobs: neither them nor their organization disabled.
export const activeAgent = sql<boolean>`(${isNull(agent.disabledAt)}
  and not ${disabledOrganization(agent.organizationId)})`

// Forge apps whose deliveries are acted on: neither them nor their
// organization disabled.
export const activeForgeApp = sql<boolean>`(${isNull(forgeApp.disabledAt)}
  and not ${disabledOrganization(forgeApp.organizationId)})`

// The billing owner's organizations, and the agents and forge apps in them,
// oldest first: what each limit counts.
const owned = {
  organizations: (tx: Db, userId: string) =>
    tx
      .select({
        id: organizationBilling.organizationId,
        disabledAt: organizationBilling.disabledAt,
        personal: organizationBilling.personal,
      })
      .from(organizationBilling)
      .innerJoin(
        organization,
        eq(organization.id, organizationBilling.organizationId),
      )
      .where(eq(organizationBilling.userId, userId))
      .orderBy(asc(organization.createdAt), asc(organization.id)),
  agents: (tx: Db, userId: string) =>
    tx
      .select({
        id: agent.id,
        disabledAt: agent.disabledAt,
        organizationDisabledAt: organizationBilling.disabledAt,
      })
      .from(agent)
      .innerJoin(
        organizationBilling,
        eq(organizationBilling.organizationId, agent.organizationId),
      )
      .where(eq(organizationBilling.userId, userId))
      .orderBy(asc(agent.createdAt), asc(agent.id)),
  forgeApps: (tx: Db, userId: string) =>
    tx
      .select({
        id: forgeApp.id,
        disabledAt: forgeApp.disabledAt,
        organizationDisabledAt: organizationBilling.disabledAt,
      })
      .from(forgeApp)
      .innerJoin(
        organizationBilling,
        eq(organizationBilling.organizationId, forgeApp.organizationId),
      )
      .where(eq(organizationBilling.userId, userId))
      .orderBy(asc(forgeApp.createdAt), asc(forgeApp.id)),
} satisfies Record<PlanLimit, unknown>

const setDisabled = (
  tx: Db,
  limit: PlanLimit,
  ids: string[],
  disabledAt: Date | null,
) => {
  if (ids.length === 0) return
  switch (limit) {
    case 'organizations':
      return tx
        .update(organizationBilling)
        .set({ disabledAt })
        .where(inArray(organizationBilling.organizationId, ids))
    case 'agents':
      return tx.update(agent).set({ disabledAt }).where(inArray(agent.id, ids))
    case 'forgeApps':
      return tx
        .update(forgeApp)
        .set({ disabledAt })
        .where(inArray(forgeApp.id, ids))
  }
}

const billingOwnerOf = async (tx: Db, organizationId: string) => {
  const [found] = await tx
    .select({
      userId: organizationBilling.userId,
      disabledAt: organizationBilling.disabledAt,
    })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId))
  return found
}

export const limitsService = {
  // The plan the user is on: the one they're subscribed to while Stripe
  // bills them (or retries a failed payment), else the default. Billing off,
  // there's none.
  async planFor(userId: string, tx: Db = db): Promise<Plan | undefined> {
    if (!env.stripe) return undefined
    const [subscribed] = await tx
      .select({ plan })
      .from(subscription)
      .innerJoin(plan, eq(plan.id, subscription.plan))
      .where(
        and(
          eq(subscription.referenceId, userId),
          inArray(subscription.status, [...holdingStatuses]),
        ),
      )
      .orderBy(desc(subscription.periodStart))
      .limit(1)
    if (subscribed) return subscribed.plan
    const [fallback] = await tx
      .select()
      .from(plan)
      .where(eq(plan.isDefault, true))
    return fallback
  },

  async limitsFor(userId: string, tx: Db = db) {
    const found = await this.planFor(userId, tx)
    return found ? limitsOf(found) : unlimited
  },

  // How much of each limit the user is using: everything they have, and how
  // much of it is enabled.
  async usage(userId: string) {
    const limits = await this.limitsFor(userId)
    const entries = await Promise.all(
      (Object.keys(owned) as PlanLimit[]).map(async (limit) => {
        const rows = await owned[limit](db, userId)
        return [
          limit,
          {
            used: rows.length,
            enabled: rows.filter((row) => !row.disabledAt).length,
            max: limits[limit],
          },
        ] as const
      }),
    )
    return Object.fromEntries(entries) as Record<
      PlanLimit,
      { used: number; enabled: number; max: number | null }
    >
  },

  // Runs `create` for the billing owner, once they have room for one more
  // under `limit`, holding their lock meanwhile; otherwise returns why not.
  async withRoom<T>(
    userId: string,
    limit: PlanLimit,
    create: (tx: Transaction) => Promise<T>,
  ) {
    return db.transaction(async (tx) => {
      await lockOwner(tx, userId)
      const max = (await this.limitsFor(userId, tx))[limit]
      if (max !== null && (await owned[limit](tx, userId)).length >= max) {
        return new PlanLimitReachedError(limit, max)
      }
      return create(tx)
    })
  },

  // Like `withRoom`, for an agent or forge app in the organization: counted
  // against its billing owner, and refused while the organization is
  // disabled.
  async withRoomIn<T>(
    organizationId: string,
    limit: 'agents' | 'forgeApps',
    create: (tx: Transaction) => Promise<T>,
  ) {
    const owner = await billingOwnerOf(db, organizationId)
    if (owner?.disabledAt) return new OrganizationDisabledError()
    // Without a billing owner (only possible mid-deletion), nothing to count.
    if (!owner) return db.transaction(create)
    return this.withRoom(owner.userId, limit, create)
  },

  // Whether changes in the organization are refused: it's read-only while
  // disabled.
  async writable(organizationId: string) {
    const owner = await billingOwnerOf(db, organizationId)
    return owner?.disabledAt ? new OrganizationDisabledError() : undefined
  },

  // Brings the user's enabled organizations, agents and forge apps in line
  // with their plan: past a limit, the newest enabled ones are disabled
  // (never the personal organization); under it, the oldest disabled ones
  // are enabled again, as many as fit. Which are enabled is otherwise left
  // as is, so a swap holds.
  reconcile: (userId: string) =>
    db.transaction(async (tx) => {
      await lockOwner(tx, userId)
      const limits = await limitsService.limitsFor(userId, tx)
      const now = new Date()
      for (const limit of Object.keys(owned) as PlanLimit[]) {
        const rows = await owned[limit](tx, userId)
        const max = limits[limit]
        const enabled = rows.filter((row) => !row.disabledAt)
        const disabled = rows.filter((row) => row.disabledAt)
        if (max === null) {
          await setDisabled(
            tx,
            limit,
            disabled.map(({ id }) => id),
            null,
          )
          continue
        }
        if (enabled.length > max) {
          const excess = enabled
            .filter((row) => !('personal' in row) || !row.personal)
            .slice(-(enabled.length - max))
          await setDisabled(
            tx,
            limit,
            excess.map(({ id }) => id),
            now,
          )
        } else if (enabled.length < max) {
          const fit = disabled.slice(0, max - enabled.length)
          await setDisabled(
            tx,
            limit,
            fit.map(({ id }) => id),
            null,
          )
        }
      }
    }),

  // Reconciles the organization's billing owner, once something of theirs
  // is deleted: a disabled one may fit again.
  async reconcileOwnerOf(organizationId: string) {
    if (!env.stripe) return
    const owner = await billingOwnerOf(db, organizationId)
    if (owner) await this.reconcile(owner.userId)
  },

  // Reconciles every billing owner: after plans change, and periodically, to
  // catch what a missed webhook would have. Billing off, enables everything.
  async reconcileAll() {
    if (!env.stripe) {
      await db
        .update(organizationBilling)
        .set({ disabledAt: null })
        .where(isNotNull(organizationBilling.disabledAt))
      await db
        .update(agent)
        .set({ disabledAt: null })
        .where(isNotNull(agent.disabledAt))
      await db
        .update(forgeApp)
        .set({ disabledAt: null })
        .where(isNotNull(forgeApp.disabledAt))
      return
    }
    const owners = await db
      .selectDistinct({ userId: organizationBilling.userId })
      .from(organizationBilling)
    for (const { userId } of owners) await this.reconcile(userId)
  },

  // Enables one of the user's disabled organizations, agents or forge apps
  // in place of an enabled one of the same kind, keeping within their plan.
  // Not an agent or forge app whose organization is disabled: that's
  // swapped first.
  swap: (
    userId: string,
    limit: PlanLimit,
    ids: { enable: string; disable: string },
  ) =>
    db.transaction(async (tx) => {
      await lockOwner(tx, userId)
      const rows = await owned[limit](tx, userId)
      const enabling = rows.find((row) => row.id === ids.enable)
      const disabling = rows.find((row) => row.id === ids.disable)
      // Enabling it alone would bring nothing back: its organization has to
      // be enabled first.
      if (
        enabling &&
        'organizationDisabledAt' in enabling &&
        enabling.organizationDisabledAt
      ) {
        return new OrganizationDisabledError()
      }
      if (
        !enabling?.disabledAt ||
        !disabling ||
        disabling.disabledAt ||
        ('personal' in disabling && disabling.personal)
      ) {
        return new SwapInvalidError()
      }
      await setDisabled(tx, limit, [disabling.id], new Date())
      await setDisabled(tx, limit, [enabling.id], null)
    }),

  // The user's disabled organizations, agents and forge apps, by name, for
  // them to pick which to keep.
  async resources(userId: string) {
    const [organizations, agents, forgeApps] = await Promise.all([
      db
        .select({
          id: organizationBilling.organizationId,
          name: organization.name,
          disabledAt: organizationBilling.disabledAt,
          personal: organizationBilling.personal,
          createdAt: organization.createdAt,
        })
        .from(organizationBilling)
        .innerJoin(
          organization,
          eq(organization.id, organizationBilling.organizationId),
        )
        .where(eq(organizationBilling.userId, userId))
        .orderBy(asc(organization.createdAt)),
      db
        .select({
          id: agent.id,
          name: agent.name,
          organization: organization.name,
          disabledAt: agent.disabledAt,
          organizationDisabled: sql<boolean>`${organizationBilling.disabledAt} is not null`,
          createdAt: agent.createdAt,
        })
        .from(agent)
        .innerJoin(
          organizationBilling,
          eq(organizationBilling.organizationId, agent.organizationId),
        )
        .innerJoin(organization, eq(organization.id, agent.organizationId))
        .where(eq(organizationBilling.userId, userId))
        .orderBy(asc(agent.createdAt)),
      db
        .select({
          id: forgeApp.id,
          name: forgeApp.name,
          organization: organization.name,
          disabledAt: forgeApp.disabledAt,
          organizationDisabled: sql<boolean>`${organizationBilling.disabledAt} is not null`,
          createdAt: forgeApp.createdAt,
        })
        .from(forgeApp)
        .innerJoin(
          organizationBilling,
          eq(organizationBilling.organizationId, forgeApp.organizationId),
        )
        .innerJoin(organization, eq(organization.id, forgeApp.organizationId))
        .where(eq(organizationBilling.userId, userId))
        .orderBy(asc(forgeApp.createdAt)),
    ])
    return { organizations, agents, forgeApps }
  },
}
