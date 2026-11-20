import { and, desc, eq, exists, gte, inArray, lt, sql } from 'drizzle-orm'
import { type MetricRange, metricBuckets } from '../../shared/metric-ranges'
import { metricsRetentionDays } from '../../shared/organization-settings'
import { firstBucket, timestamp } from '../platform/buckets'
import { db, type Transaction } from '../platform/db'
import { agent, agentMetric, organizationSettings } from '../platform/db/schema'
import { AgentNotFoundError } from './errors'

const minute = 60 * 1000
const day = 24 * 60 * minute

// An agent reports a reading every 15 seconds at most (see its config):
// closer ones are dropped, so an agent can't fill the table faster.
const MIN_READING_GAP_MS = 10 * 1000

// Agents report a reading every 10 minutes at least: an older one is no
// longer the agent's current state.
const CURRENT_FOR_MS = 11 * minute

export type MetricsReading = {
  cpu: number
  memoryUsed: number
  memoryTotal: number
  diskUsed: number
  diskTotal: number
}

const readingColumns = {
  recordedAt: agentMetric.recordedAt,
  cpu: agentMetric.cpu,
  memoryUsed: agentMetric.memoryUsed,
  memoryTotal: agentMetric.memoryTotal,
  diskUsed: agentMetric.diskUsed,
  diskTotal: agentMetric.diskTotal,
}

const average = (column: unknown) => sql<number | null>`avg(${column})::float8`
const largest = (column: unknown) => sql<number | null>`max(${column})::float8`

export const agentMetricsService = {
  // Records an agent's reading, in the transaction of its poll, which holds
  // the agent's row: unless its previous reading is too recent.
  async record(
    tx: Transaction,
    agentId: string,
    reading: MetricsReading,
    now: Date,
  ) {
    const [recent] = await tx
      .select({ recordedAt: agentMetric.recordedAt })
      .from(agentMetric)
      .where(
        and(
          eq(agentMetric.agentId, agentId),
          gte(
            agentMetric.recordedAt,
            new Date(now.getTime() - MIN_READING_GAP_MS),
          ),
        ),
      )
      .limit(1)
    if (recent) return
    await tx
      .insert(agentMetric)
      .values({ agentId, recordedAt: now, ...reading })
      .onConflictDoNothing()
  },

  // The current reading of each of `agentIds` that has one, by agent id.
  async current(agentIds: string[], now = new Date()) {
    if (agentIds.length === 0) return new Map<string, never>()
    const rows = await db
      .selectDistinctOn([agentMetric.agentId], {
        agentId: agentMetric.agentId,
        ...readingColumns,
      })
      .from(agentMetric)
      .where(
        and(
          inArray(agentMetric.agentId, agentIds),
          gte(agentMetric.recordedAt, new Date(now.getTime() - CURRENT_FOR_MS)),
        ),
      )
      .orderBy(agentMetric.agentId, desc(agentMetric.recordedAt))
    return new Map(rows.map(({ agentId, ...reading }) => [agentId, reading]))
  },

  // One of the organization's agents' readings over `range`, averaged per
  // point (null where it reported none), and its current reading. Points
  // start on the viewer's clock (`utcOffset` minutes ahead of UTC).
  async history(
    organizationId: string,
    id: string,
    range: MetricRange,
    { now = new Date(), utcOffset = 0 } = {},
  ) {
    const [found] = await db
      .select({ id: agent.id })
      .from(agent)
      .where(and(eq(agent.id, id), eq(agent.organizationId, organizationId)))
    if (!found) return new AgentNotFoundError()

    const { size, count } = metricBuckets[range]
    const start = firstBucket(now, size, count, utcOffset)
    const bucket = sql`date_bin(
      make_interval(secs => ${size / 1000}),
      ${agentMetric.recordedAt},
      ${timestamp(start)}
    )`
    const [rows, current] = await Promise.all([
      db
        .select({
          start: bucket.mapWith(agentMetric.recordedAt),
          cpu: average(agentMetric.cpu),
          memoryUsed: average(agentMetric.memoryUsed),
          memoryTotal: largest(agentMetric.memoryTotal),
          diskUsed: average(agentMetric.diskUsed),
          diskTotal: largest(agentMetric.diskTotal),
        })
        .from(agentMetric)
        .where(
          and(eq(agentMetric.agentId, id), gte(agentMetric.recordedAt, start)),
        )
        // By position: the same expression bound twice reads as two to
        // Postgres.
        .groupBy(sql`1`),
      agentMetricsService.current([id], now),
    ])
    const byStart = new Map(rows.map((row) => [row.start.getTime(), row]))
    return {
      range,
      bucketSize: size,
      current: current.get(id) ?? null,
      points: Array.from({ length: count }, (_, i) => {
        const at = new Date(start.getTime() + i * size)
        const row = byStart.get(at.getTime())
        return {
          start: at,
          cpu: row?.cpu ?? null,
          memoryUsed: row?.memoryUsed ?? null,
          memoryTotal: row?.memoryTotal ?? null,
          diskUsed: row?.diskUsed ?? null,
          diskTotal: row?.diskTotal ?? null,
        }
      }),
    }
  },

  // Deletes the readings past their organization's retention (see its
  // settings), in days before `now`.
  async prune(now = new Date()) {
    const retention = sql`make_interval(days => coalesce(
      ${organizationSettings.metricsRetentionDays},
      ${metricsRetentionDays.default}
    ))`
    await db.delete(agentMetric).where(
      and(
        // No organization keeps them for less: narrows the scan by index.
        lt(
          agentMetric.recordedAt,
          new Date(now.getTime() - metricsRetentionDays.min * day),
        ),
        exists(
          db
            .select({ id: agent.id })
            .from(agent)
            .leftJoin(
              organizationSettings,
              eq(organizationSettings.organizationId, agent.organizationId),
            )
            .where(
              and(
                eq(agent.id, agentMetric.agentId),
                sql`${agentMetric.recordedAt} < ${timestamp(now)} - ${retention}`,
              ),
            ),
        ),
      ),
    )
  },
}
