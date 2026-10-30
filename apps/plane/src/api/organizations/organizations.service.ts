import { asc, eq } from 'drizzle-orm'
import { db } from '../platform/db'
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
}
