import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { createAgent, createOrganization } from '../../../test/fixtures'
import { settingsService } from '../organizations/settings.service'
import { db } from '../platform/db'
import { agentMetric } from '../platform/db/schema'
import { AgentNotFoundError } from './errors'
import { agentMetricsService } from './metrics.service'

const now = new Date('2026-10-31T12:30:30Z')
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60 * 1000)
const daysAgo = (days: number) => minutesAgo(days * 24 * 60)

const GiB = 2 ** 30

let organizationId: string
let agentId: string

beforeEach(async () => {
  ;({ organizationId } = await createOrganization())
  agentId = (await createAgent(organizationId)).id
})

const insert = (
  recordedAt: Date,
  values: Partial<typeof agentMetric.$inferInsert> = {},
  id = agentId,
) =>
  db.insert(agentMetric).values({
    agentId: id,
    recordedAt,
    cpu: 0.5,
    memoryUsed: 8 * GiB,
    memoryTotal: 16 * GiB,
    diskUsed: 100 * GiB,
    diskTotal: 500 * GiB,
    ...values,
  })

const recordedAt = async (id = agentId) =>
  (
    await db
      .select({ at: agentMetric.recordedAt })
      .from(agentMetric)
      .where(eq(agentMetric.agentId, id))
      .orderBy(agentMetric.recordedAt)
  ).map(({ at }) => at)

describe('history', () => {
  test('averages the readings per point, leaving gaps empty', async () => {
    await insert(minutesAgo(2.5), { cpu: 0.2, memoryUsed: 4 * GiB })
    await insert(minutesAgo(2.25), { cpu: 0.4, memoryUsed: 6 * GiB })
    await insert(minutesAgo(0.25), { cpu: 0.9 })
    // Before the range.
    await insert(minutesAgo(90), { cpu: 1 })

    const history = await agentMetricsService.history(
      organizationId,
      agentId,
      '1h',
      { now },
    )
    if (history instanceof Error) throw history
    expect(history.points).toHaveLength(60)
    expect(history.points.at(-1)).toMatchObject({
      start: new Date('2026-10-31T12:30:00Z'),
      cpu: expect.closeTo(0.9),
    })
    expect(history.points.at(-2)?.cpu).toBeNull()
    expect(history.points.at(-3)).toMatchObject({
      start: new Date('2026-10-31T12:28:00Z'),
      cpu: expect.closeTo(0.3),
      memoryUsed: 5 * GiB,
      memoryTotal: 16 * GiB,
    })
    expect(history.points.filter(({ cpu }) => cpu !== null)).toHaveLength(2)
    expect(history.current).toMatchObject({
      recordedAt: minutesAgo(0.25),
      cpu: expect.closeTo(0.9),
    })
  })

  test("has no current reading once the agent's last one is old", async () => {
    await insert(minutesAgo(20))
    const history = await agentMetricsService.history(
      organizationId,
      agentId,
      '24h',
      { now },
    )
    if (history instanceof Error) throw history
    expect(history.current).toBeNull()
    expect(history.points.filter(({ cpu }) => cpu !== null)).toHaveLength(1)
  })

  test("is scoped to the organization's agents", async () => {
    const other = await createOrganization()
    expect(
      await agentMetricsService.history(other.organizationId, agentId, '1h'),
    ).toBeInstanceOf(AgentNotFoundError)
  })
})

describe('current', () => {
  test("is each agent's latest recent reading", async () => {
    const idle = (await createAgent(organizationId)).id
    await insert(minutesAgo(1), { cpu: 0.1 })
    await insert(minutesAgo(0.5), { cpu: 0.7 })
    const current = await agentMetricsService.current([agentId, idle], now)
    expect(current.get(agentId)?.cpu).toBeCloseTo(0.7)
    expect(current.has(idle)).toBe(false)
  })
})

describe('prune', () => {
  test("deletes the readings past their organization's retention", async () => {
    await insert(daysAgo(31))
    await insert(daysAgo(29))

    const other = await createOrganization()
    await settingsService.update(other.organizationId, {
      metricsRetentionDays: 2,
    })
    const short = (await createAgent(other.organizationId)).id
    await insert(daysAgo(3), {}, short)
    await insert(daysAgo(1), {}, short)

    await agentMetricsService.prune(now)
    expect(await recordedAt()).toEqual([daysAgo(29)])
    expect(await recordedAt(short)).toEqual([daysAgo(1)])
  })
})
