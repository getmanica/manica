import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import {
  type OverviewRange,
  overviewBuckets,
  overviewRangeLength,
} from '../../shared/job-ranges'
import { db } from '../platform/db'
import { agent, job, liveStates, runner } from '../platform/db/schema'
import { LEASE_MS } from '../runners/runners.service'

// Stored timestamps are UTC without a zone, as drizzle writes them; casting an
// ISO string drops its `Z` without shifting it.
const timestamp = (date: Date) => sql`${date.toISOString()}::timestamp`

const seconds = (from: unknown, to: unknown) =>
  sql`extract(epoch from ${to} - ${from})`

// Counts and averages for the jobs queued in [from, to). Averages are in
// seconds, or null with nothing to average: run time over the jobs that ran
// to an end, queue wait over the jobs that started.
const periodStats = async (organizationId: string, from: Date, to: Date) => {
  const [stats] = await db
    .select({
      jobs: sql<number>`count(*)::int`,
      runTime: sql<
        number | null
      >`(avg(${seconds(job.startedAt, job.completedAt)}) filter (
        where ${job.status} = 'completed'
        and ${job.conclusion} <> 'skipped'
        and ${job.startedAt} is not null
        and ${job.completedAt} is not null
      ))::float`,
      queueWait: sql<
        number | null
      >`(avg(${seconds(job.queuedAt, job.startedAt)}) filter (
        where ${job.startedAt} is not null
      ))::float`,
    })
    .from(job)
    .where(
      and(
        eq(job.organizationId, organizationId),
        gte(job.queuedAt, from),
        lt(job.queuedAt, to),
      ),
    )
  return stats ?? { jobs: 0, runTime: null, queueWait: null }
}

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

// Finished jobs per bar, by how they ended.
const buckets = async (
  organizationId: string,
  range: OverviewRange,
  now: Date,
  utcOffset: number,
) => {
  const { size, count } = overviewBuckets[range]
  const start = firstBucket(now, size, count, utcOffset)
  const bucket = sql`date_bin(
    make_interval(secs => ${size / 1000}),
    ${job.queuedAt},
    ${timestamp(start)}
  )`
  const rows = await db
    .select({
      start: bucket.mapWith(job.queuedAt),
      succeeded: sql<number>`(count(*) filter (where ${job.conclusion} = 'success'))::int`,
      failed: sql<number>`(count(*) filter (where ${job.conclusion} in ('failure', 'timed_out')))::int`,
      cancelled: sql<number>`(count(*) filter (where ${job.conclusion} = 'cancelled'))::int`,
      other: sql<number>`(count(*) filter (where ${job.conclusion} is null or ${job.conclusion} not in ('success', 'failure', 'timed_out', 'cancelled')))::int`,
    })
    .from(job)
    .where(
      and(
        eq(job.organizationId, organizationId),
        eq(job.status, 'completed'),
        gte(job.queuedAt, start),
      ),
    )
    // By position: the same expression bound twice reads as two to Postgres.
    .groupBy(sql`1`)
  const byStart = new Map(rows.map((row) => [row.start.getTime(), row]))
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(start.getTime() + i * size)
    const row = byStart.get(at.getTime())
    return {
      start: at,
      succeeded: row?.succeeded ?? 0,
      failed: row?.failed ?? 0,
      cancelled: row?.cancelled ?? 0,
      other: row?.other ?? 0,
    }
  })
}

// Every agent, whether it's online (polled within a runner lease: past that
// its runners count as lost), and the jobs its live runners are running.
const agents = async (organizationId: string, now: Date) => {
  const [agents, runners] = await Promise.all([
    db
      .select({
        id: agent.id,
        name: agent.name,
        slots: agent.slots,
        lastSeenAt: agent.lastSeenAt,
      })
      .from(agent)
      .where(eq(agent.organizationId, organizationId))
      .orderBy(asc(agent.name)),
    db
      .select({
        agentId: runner.agentId,
        job: {
          id: job.id,
          name: job.name,
          repository: job.repository,
          url: job.url,
          startedAt: job.startedAt,
        },
      })
      .from(runner)
      .innerJoin(agent, eq(runner.agentId, agent.id))
      .leftJoin(job, eq(runner.jobId, job.id))
      .where(
        and(
          eq(agent.organizationId, organizationId),
          inArray(runner.state, liveStates),
        ),
      ),
  ])
  const onlineSince = now.getTime() - LEASE_MS
  return agents.map(({ lastSeenAt, ...rest }) => {
    const live = runners.filter((runner) => runner.agentId === rest.id)
    return {
      ...rest,
      online: !!lastSeenAt && lastSeenAt.getTime() >= onlineSince,
      running: live.length,
      jobs: live.flatMap((runner) => (runner.job ? [runner.job] : [])),
    }
  })
}

export const overviewService = {
  // The organization at a glance over `range`, compared with the range
  // before it.
  async get(
    organizationId: string,
    range: OverviewRange,
    { now = new Date(), utcOffset = 0 } = {},
  ) {
    const length = overviewRangeLength(range)
    const from = new Date(now.getTime() - length)
    const before = new Date(from.getTime() - length)
    const [current, previous, chart, agentList] = await Promise.all([
      periodStats(organizationId, from, now),
      periodStats(organizationId, before, from),
      buckets(organizationId, range, now, utcOffset),
      agents(organizationId, now),
    ])
    return {
      range,
      bucketSize: overviewBuckets[range].size,
      current,
      previous,
      buckets: chart,
      agents: agentList,
    }
  },
}
