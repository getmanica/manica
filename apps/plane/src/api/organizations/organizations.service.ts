import { asc, eq, inArray, sql } from 'drizzle-orm'
import { db, type Transaction } from '../platform/db'
import { member, organization } from '../platform/db/schema'

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
    })
    return organizationId
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

  // Deletes the organizations the user is the only member of, with
  // everything in them; organizations shared with others stay. Within `tx`,
  // if given, to go with the user's own deletion.
  async deleteSoleOwned(userId: string, tx: Transaction | typeof db = db) {
    const sole = tx
      .select({ id: member.organizationId })
      .from(member)
      .groupBy(member.organizationId)
      .having(sql`count(*) = 1 and bool_and(${member.userId} = ${userId})`)
    await tx.delete(organization).where(inArray(organization.id, sole))
  },
}
