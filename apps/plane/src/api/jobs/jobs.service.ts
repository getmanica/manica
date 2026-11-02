import {
  type AnyColumn,
  and,
  count,
  eq,
  gte,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import {
  agentLabelSet,
  matchesLabels,
  normalizeLabels,
} from '../../shared/labels'
import type { JobSort } from '../../shared/pagination'
import type { JobEvent } from '../forges/forge'
import { db } from '../platform/db'
import { agent, job, runner } from '../platform/db/schema'
import {
  containing,
  filterText,
  type ListOptions,
  pageWindow,
  sortBy,
} from '../platform/pagination'
import { linkStartedRunner } from '../runners/link'

const publicColumns = {
  id: job.id,
  forgeAppId: job.forgeAppId,
  repository: job.repository,
  name: job.name,
  url: job.url,
  labels: job.labels,
  status: job.status,
  conclusion: job.conclusion,
  runnerName: job.runnerName,
  // The agent that ran it, if one of the organization's did.
  agentName: agent.name,
  queuedAt: job.queuedAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
}

// See `shared/job-outcomes`.
const outcome = sql<string>`case when ${job.status} = 'completed' and ${job.conclusion} is not null then ${job.conclusion} else ${job.status}::text end`

// The outcome as the console shows it, lowercased: what the filter box
// matches and the status column sorts by.
const outcomeText = sql<string>`case when ${outcome} = 'in_progress' then 'running' else replace(${outcome}, '_', ' ') end`

const labelsText = sql<string>`array_to_string(${job.labels}, ' ')`

const sorts: Record<JobSort, SQL | AnyColumn> = {
  name: job.name,
  repository: job.repository,
  outcome: outcomeText,
  agent: agent.name,
  labels: labelsText,
  queuedAt: job.queuedAt,
}

// Whether any of the organization's agents could run a job asking for
// `labels`. Organizations have a handful of agents, so this matches in
// memory rather than in SQL.
const anyAgentMatches = async (organizationId: string, labels: string[]) => {
  const agents = await db
    .select({
      name: agent.name,
      os: agent.os,
      arch: agent.arch,
      labels: agent.labels,
    })
    .from(agent)
    .where(eq(agent.organizationId, organizationId))
  return agents.some((agent) => matchesLabels(labels, agentLabelSet(agent)))
}

// Stored timestamps are UTC without a zone, as drizzle writes them; casting an
// ISO string drops its `Z` without shifting it.
const timestamp = (date: Date | null) =>
  sql`${date?.toISOString() ?? null}::timestamp`

// Merges an event into the stored job. Deliveries can arrive late or out of
// order: the status only moves forward (job_status is ordered queued <
// in_progress < completed), and what an event knows never erases what an
// earlier one did.
const merge = (event: JobEvent) => ({
  status: sql`greatest(${job.status}, ${event.status}::job_status)`,
  conclusion: sql`coalesce(${event.conclusion}, ${job.conclusion})`,
  externalRunnerId: sql`coalesce(${event.externalRunnerId}, ${job.externalRunnerId})`,
  runnerName: sql`coalesce(${event.runnerName}, ${job.runnerName})`,
  startedAt: sql`coalesce(${timestamp(event.startedAt)}, ${job.startedAt})`,
  completedAt: sql`coalesce(${timestamp(event.completedAt)}, ${job.completedAt})`,
  updatedAt: new Date(),
})

export const jobsService = {
  // A page of the organization's jobs, latest first unless sorted otherwise:
  // only those queued since `since`, with one of `outcomes`, and whose name,
  // repository, agent, outcome or labels contain the filter text. Also lists
  // the outcomes the jobs since `since` have, for the status filter.
  async list(
    organizationId: string,
    {
      since,
      outcomes,
      sort = 'queuedAt',
      dir = 'desc',
      ...options
    }: ListOptions<JobSort> & { since?: Date; outcomes?: string[] } = {},
  ) {
    const scope = and(
      eq(job.organizationId, organizationId),
      since ? gte(job.queuedAt, since) : undefined,
    )
    const text = filterText(options.q)
    const pattern = text && containing(text)
    const where = and(
      scope,
      outcomes?.length ? inArray(outcome, outcomes) : undefined,
      pattern
        ? or(
            ilike(job.name, pattern),
            ilike(job.repository, pattern),
            ilike(agent.name, pattern),
            ilike(outcomeText, pattern),
            ilike(labelsText, pattern),
          )
        : undefined,
    )
    const { limit, offset } = pageWindow(options)

    const [items, [counted], present] = await Promise.all([
      db
        .select(publicColumns)
        .from(job)
        .leftJoin(runner, eq(runner.jobId, job.id))
        .leftJoin(agent, eq(runner.agentId, agent.id))
        .where(where)
        .orderBy(...sortBy(sorts[sort], dir, job.id))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(job)
        .leftJoin(runner, eq(runner.jobId, job.id))
        .leftJoin(agent, eq(runner.agentId, agent.id))
        .where(where),
      db.selectDistinct({ outcome }).from(job).where(scope).orderBy(outcome),
    ])
    return {
      items,
      total: counted?.total ?? 0,
      outcomes: present.map(({ outcome }) => outcome),
    }
  },

  // Records what a forge app said about a job. The organization is the
  // app's, never taken from the delivery. A job none of the organization's
  // agents could run (e.g. one for a forge-hosted runner) isn't stored; if
  // it already is, it's still kept up to date.
  async record(app: { id: string; organizationId: string }, event: JobEvent) {
    const labels = normalizeLabels(event.labels)
    const changes = merge(event)

    const [recorded] = (await anyAgentMatches(app.organizationId, labels))
      ? await db
          .insert(job)
          .values({
            id: crypto.randomUUID(),
            organizationId: app.organizationId,
            forgeAppId: app.id,
            externalId: event.externalId,
            runId: event.runId,
            installationId: event.installationId,
            repository: event.repository,
            name: event.name,
            url: event.url,
            labels,
            status: event.status,
            conclusion: event.conclusion,
            externalRunnerId: event.externalRunnerId,
            runnerName: event.runnerName,
            queuedAt: event.queuedAt,
            startedAt: event.startedAt,
            completedAt: event.completedAt,
          })
          .onConflictDoUpdate({
            target: [job.forgeAppId, job.externalId],
            set: changes,
          })
          .returning({ id: job.id })
      : await db
          .update(job)
          .set(changes)
          .where(
            and(
              eq(job.forgeAppId, app.id),
              eq(job.externalId, event.externalId),
            ),
          )
          .returning({ id: job.id })

    if (recorded && event.status !== 'queued') {
      await linkStartedRunner(app, recorded.id, event)
    }
  },
}
