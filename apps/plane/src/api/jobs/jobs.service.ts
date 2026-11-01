import { and, desc, eq, sql } from 'drizzle-orm'
import {
  agentLabelSet,
  matchesLabels,
  normalizeLabels,
} from '../../shared/labels'
import type { JobEvent } from '../forges/forge'
import { db } from '../platform/db'
import { agent, job, runner } from '../platform/db/schema'
import { linkStartedRunner } from '../runners/link'

const MAX_LISTED = 100

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
  list: (organizationId: string) =>
    db
      .select(publicColumns)
      .from(job)
      .leftJoin(runner, eq(runner.jobId, job.id))
      .leftJoin(agent, eq(runner.agentId, agent.id))
      .where(eq(job.organizationId, organizationId))
      .orderBy(desc(job.queuedAt))
      .limit(MAX_LISTED),

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
