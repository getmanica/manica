// How far back the jobs list looks, picked in the console.

export const jobRanges = ['1h', '24h', '7d', '30d', 'all'] as const
export type JobRange = (typeof jobRanges)[number]

const hour = 60 * 60 * 1000

const durations: Record<Exclude<JobRange, 'all'>, number> = {
  '1h': hour,
  '24h': 24 * hour,
  '7d': 7 * 24 * hour,
  '30d': 30 * 24 * hour,
}

// The earliest queue time a range includes, or none for all time.
export const jobRangeStart = (range: JobRange, now = new Date()) =>
  range === 'all' ? undefined : new Date(now.getTime() - durations[range])

// The overview compares a range with the one before it, so it has no
// "all time".
export const overviewRanges = ['1h', '24h', '7d', '30d'] as const
export type OverviewRange = (typeof overviewRanges)[number]

const minute = 60 * 1000

// The overview chart's bars: how long each covers, and how many.
export const overviewBuckets: Record<
  OverviewRange,
  { size: number; count: number }
> = {
  '1h': { size: 5 * minute, count: 12 },
  '24h': { size: hour, count: 24 },
  '7d': { size: 6 * hour, count: 28 },
  '30d': { size: 24 * hour, count: 30 },
}

export const overviewRangeLength = (range: OverviewRange) => durations[range]
