import { sql } from 'drizzle-orm'

// Stored timestamps are UTC without a zone, as drizzle writes them; casting an
// ISO string drops its `Z` without shifting it.
export const timestamp = (date: Date) => sql`${date.toISOString()}::timestamp`

// The first of `count` bars of `size` ending with the one `now` falls in.
// Bars start on the viewer's clock (`utcOffset` minutes ahead of UTC), so
// day bars start at their midnight.
export const firstBucket = (
  now: Date,
  size: number,
  count: number,
  utcOffset: number,
) => {
  const offset = utcOffset * 60 * 1000
  const current = Math.floor((now.getTime() + offset) / size) * size - offset
  return new Date(current - (count - 1) * size)
}
