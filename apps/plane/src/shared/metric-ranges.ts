// How far back an agent's metrics chart looks, picked in the console, and
// the points it's drawn with: each averages the readings over `size`.

export const metricRanges = ['1h', '24h', '7d', '30d', '90d'] as const
export type MetricRange = (typeof metricRanges)[number]

const minute = 60 * 1000
const hour = 60 * minute

export const metricBuckets: Record<
  MetricRange,
  { size: number; count: number }
> = {
  '1h': { size: minute, count: 60 },
  '24h': { size: 15 * minute, count: 96 },
  '7d': { size: 2 * hour, count: 84 },
  '30d': { size: 6 * hour, count: 120 },
  '90d': { size: 24 * hour, count: 90 },
}
