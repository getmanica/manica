import { and, eq, sql } from 'drizzle-orm'
import { db } from '../platform/db'
import { user } from '../platform/db/schema'

// Whether the user is banned right now. An expired ban is lifted only when
// the user next signs in (see `liftExpiredBan`), so until then `banned`
// stays set: its expiry decides. Timestamps are stored as UTC without a time zone, so
// they're compared with the time in UTC, whatever the database's zone.
export const bannedNow = sql<boolean>`(coalesce(${user.banned}, false) and (${user.banExpires} is null or ${user.banExpires} > (now() at time zone 'UTC')))`

// Whether the user is banned right now (see `bannedNow`). Waits for a ban
// under way: banning locks the user until they're signed out too.
export const isBanned = async (userId: string) => {
  const [found] = await db
    .select({ banned: bannedNow })
    .from(user)
    .where(eq(user.id, userId))
    .for('share')
  return !!found?.banned
}

// The fields a ban sets, and lifting it clears.
const banFields = new Set(['banned', 'banReason', 'banExpires', 'updatedAt'])

// Whether a user update lifts a ban, and nothing else. The admin plugin
// lifts an expired one as the user signs in, overwriting whatever it read:
// a ban an admin set just then would be lost. Only unbanning may (see
// `auth/better-auth.ts`); `liftExpiredBan` does the rest.
export const liftsBan = (data: Record<string, unknown>) =>
  data.banned === false && Object.keys(data).every((key) => banFields.has(key))

// Clears the user's ban if it has expired, and only then: one set since,
// expiring later or never, stays.
export const liftExpiredBan = (userId: string) =>
  db
    .update(user)
    .set({ banned: false, banReason: null, banExpires: null })
    .where(
      and(
        eq(user.id, userId),
        eq(user.banned, true),
        sql`${user.banExpires} <= (now() at time zone 'UTC')`,
      ),
    )
