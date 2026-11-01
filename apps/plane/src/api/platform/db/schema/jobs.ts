import { sql } from 'drizzle-orm'
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { organization } from './auth'
import { forgeApp } from './forge-apps'

// Ordered: a job's status only moves forward through them.
export const jobStatuses = ['queued', 'in_progress', 'completed'] as const
export type JobStatus = (typeof jobStatuses)[number]

export const jobStatus = pgEnum('job_status', jobStatuses)

// A CI job a forge app was told about, that one of the organization's agents
// could run. `status` only moves forward (see `jobsService.record`), so late
// deliveries don't undo it. `labels` are stored lowercased.
export const job = pgTable(
  'job',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    forgeAppId: text('forge_app_id')
      .notNull()
      .references(() => forgeApp.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    runId: text('run_id').notNull(),
    installationId: text('installation_id').notNull(),
    repository: text('repository').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    labels: text('labels').array().notNull(),
    status: jobStatus('status').notNull(),
    conclusion: text('conclusion'),
    externalRunnerId: text('external_runner_id'),
    runnerName: text('runner_name'),
    queuedAt: timestamp('queued_at').notNull(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('job_forgeAppId_externalId_unique').on(
      table.forgeAppId,
      table.externalId,
    ),
    index('job_organizationId_queuedAt_idx').on(
      table.organizationId,
      table.queuedAt,
    ),
    // The queue: jobs waiting for a runner, oldest first.
    index('job_queued_idx')
      .on(table.organizationId, table.queuedAt)
      .where(sql`${table.status} = 'queued'`),
  ],
)
