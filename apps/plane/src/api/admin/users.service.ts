import {
  type AnyColumn,
  asc,
  count,
  eq,
  ilike,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { UserSort } from '../../shared/pagination'
import { bannedNow } from '../auth/bans'
import { billingService } from '../billing/billing.service'
import { BillingCancelFailedError } from '../billing/errors'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import { member, organization, session, user } from '../platform/db/schema'
import {
  containing,
  filterText,
  type ListOptions,
  pageWindow,
  sortBy,
} from '../platform/pagination'
import {
  CannotBanSelfError,
  CannotRemoveSelfError,
  UserNotFoundError,
} from './errors'

// Every user of the plane, for its admins (see `auth/session`'s `admin`).

// Users from before the admin plugin have no role: they're users.
const role = sql<string>`coalesce(${user.role}, 'user')`

const sorts: Record<UserSort, SQL | AnyColumn> = {
  name: user.name,
  role,
  status: bannedNow,
  createdAt: user.createdAt,
}

export const adminUsersService = {
  // A page of the plane's users, newest first unless sorted otherwise: only
  // those whose name or email contain the filter text. Each with how many
  // organizations they're in, and whether they're banned now (an expired
  // ban isn't one).
  async list({
    sort = 'createdAt',
    dir = 'desc',
    ...options
  }: ListOptions<UserSort> = {}) {
    const text = filterText(options.q)
    const pattern = text && containing(text)
    const where = pattern
      ? or(ilike(user.name, pattern), ilike(user.email, pattern))
      : undefined
    const { limit, offset } = pageWindow(options)

    const memberships = db
      .select({ userId: member.userId, count: count().as('count') })
      .from(member)
      .groupBy(member.userId)
      .as('memberships')

    const [items, total] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role,
          banned: bannedNow,
          banReason: user.banReason,
          banExpires: user.banExpires,
          organizations: sql<number>`coalesce(${memberships.count}, 0)::int`,
          createdAt: user.createdAt,
        })
        .from(user)
        .leftJoin(memberships, eq(memberships.userId, user.id))
        .where(where)
        .orderBy(...sortBy(sorts[sort], dir, user.id))
        .limit(limit)
        .offset(offset),
      db.$count(user, where),
    ])
    return {
      items: items.map((item) =>
        // A lifted or expired ban's reason and expiry are history.
        item.banned ? item : { ...item, banReason: null, banExpires: null },
      ),
      total,
    }
  },

  // Removes the user, with everything that's theirs: sessions, sign-ins,
  // memberships, and the organizations they're the billing owner of or only
  // they were in. Stripe stops billing them first, or nothing is removed.
  // All or nothing: a failure leaves the user as they were (bar the
  // cancelled subscriptions). Not the admin themselves.
  async remove(adminId: string, userId: string) {
    if (userId === adminId) return new CannotRemoveSelfError()
    const failed = await billingService
      .cancelAll(userId)
      .then(() => undefined)
      .catch((error: unknown) => {
        if (error instanceof BillingCancelFailedError) return error
        throw error
      })
    if (failed) return failed
    return db.transaction(async (tx) => {
      const [found] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for('update')
      if (!found) return new UserNotFoundError()
      // Their organizations, locked: someone joining one meanwhile waits
      // (adding a member checks its organization), and one who joined just
      // before is counted, so an organization they share isn't deleted
      // unless they're its billing owner.
      await tx
        .select({ id: organization.id })
        .from(organization)
        .innerJoin(member, eq(member.organizationId, organization.id))
        .where(eq(member.userId, userId))
        // Always in the same order, so removing two users who share
        // organizations can't deadlock.
        .orderBy(asc(organization.id))
        .for('update', { of: organization })
      await organizationsService.deleteOwned(userId, tx)
      await tx.delete(user).where(eq(user.id, userId))
      return { id: userId }
    })
  },

  // Bans the user, for `expiresIn` seconds or until unbanned, and signs them
  // out everywhere, at once: a failure leaves them as they were, never
  // banned yet signed in. The row stays locked until both are done, so a
  // sign-in checking for a ban meanwhile waits for it (see `auth/bans`).
  // Not the admin themselves.
  async ban(
    adminId: string,
    userId: string,
    { reason, expiresIn }: { reason?: string; expiresIn?: number },
  ) {
    if (userId === adminId) return new CannotBanSelfError()
    return db.transaction(async (tx) => {
      const [found] = await tx
        .update(user)
        .set({
          banned: true,
          banReason: reason?.trim() || null,
          banExpires: expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : null,
        })
        .where(eq(user.id, userId))
        .returning({ id: user.id })
      if (!found) return new UserNotFoundError()
      await tx.delete(session).where(eq(session.userId, userId))
      return { id: userId }
    })
  },
}
