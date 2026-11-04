import { asc, eq, inArray, or, sql } from 'drizzle-orm'
import { db, type Transaction } from '../platform/db'
import {
  member,
  organization,
  organizationBilling,
} from '../platform/db/schema'

export const organizationsService = {
  // Every user owns a personal organization, created on their first session.
  async createPersonal(userId: string) {
    const organizationId = crypto.randomUUID()
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx.insert(organization).values({
        id: organizationId,
        name: 'Personal',
        slug: `personal-${userId.toLowerCase()}`,
        createdAt: now,
      })
      await tx.insert(member).values({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        role: 'owner',
        createdAt: now,
      })
      await tx
        .insert(organizationBilling)
        .values({ organizationId, userId, personal: true })
    })
    return organizationId
  },

  // Makes the user the billing owner of an organization they just created
  // (through the organization plugin, see `auth/better-auth.ts`).
  async attachBillingOwner(organizationId: string, userId: string) {
    await db
      .insert(organizationBilling)
      .values({ organizationId, userId })
      .onConflictDoNothing()
  },

  // Who the organization counts against, if anyone.
  async billingOwner(organizationId: string) {
    const [found] = await db
      .select({ userId: organizationBilling.userId })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, organizationId))
    return found?.userId
  },

  // The organization a new session starts in: the user's oldest membership,
  // creating their personal organization if they have none.
  async defaultFor(userId: string) {
    const [membership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt))
      .limit(1)
    return membership?.organizationId ?? this.createPersonal(userId)
  },

  // Deletes the organizations the user is the billing owner of, shared or
  // not, and those they're the only member of, with everything in them.
  // Within `tx`, if given, to go with the user's own deletion.
  async deleteOwned(userId: string, tx: Transaction | typeof db = db) {
    const billed = tx
      .select({ id: organizationBilling.organizationId })
      .from(organizationBilling)
      .where(eq(organizationBilling.userId, userId))
    const sole = tx
      .select({ id: member.organizationId })
      .from(member)
      .groupBy(member.organizationId)
      .having(sql`count(*) = 1 and bool_and(${member.userId} = ${userId})`)
    await tx
      .delete(organization)
      .where(
        or(inArray(organization.id, billed), inArray(organization.id, sole)),
      )
  },
}
