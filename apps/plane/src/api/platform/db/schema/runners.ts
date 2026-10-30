import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { agent } from './agents'
import { forgeApp } from './forge-apps'
import { job } from './jobs'

// A runner's life, as the plane tracks it:
// - registering: claimed for a job, being registered with the forge.
// - issued: registered, its config sent to the agent, not yet acknowledged.
// - acked: the agent has it (it listed it in a poll) and is starting it.
// - running: the forge says it picked up a job.
// - exited: the agent says its process exited.
// - released: dropped before it ran a job (lease expired, agent restarted,
//   registration failed, or no longer needed).
// - lost: its agent went silent while it ran a job.
export const runnerStates = [
  'registering',
  'issued',
  'acked',
  'running',
  'exited',
  'released',
  'lost',
] as const
export type RunnerState = (typeof runnerStates)[number]

// States that take one of the agent's slots and count as serving a job.
export const liveStates = [
  'registering',
  'issued',
  'acked',
  'running',
] as const satisfies RunnerState[]

export const runnerState = pgEnum('runner_state', runnerStates)

const liveRunner = sql.raw(
  `"state" in (${liveStates.map((state) => `'${state}'`).join(', ')})`,
)

// A just-in-time runner registered for one of an agent's slots. It's
// registered on one repository through one installation, with `labels`:
// GitHub may hand it any job those labels cover. `reservedJobId` is the
// queued job it was registered for, until it starts one; `jobId` is the job
// it actually ran. `leaseExpiresAt` is renewed by the agent's polls.
// `cleanupAt` is when to next try to unregister it from the forge, if
// that's still to do.
export const runner = pgTable(
  'runner',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    forgeAppId: text('forge_app_id')
      .notNull()
      .references(() => forgeApp.id, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    repository: text('repository').notNull(),
    labels: text('labels').array().notNull(),
    state: runnerState('state').notNull(),
    reservedJobId: text('reserved_job_id').references(() => job.id, {
      onDelete: 'set null',
    }),
    jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
    externalRunnerId: text('external_runner_id'),
    leaseExpiresAt: timestamp('lease_expires_at').notNull(),
    exitCode: integer('exit_code'),
    cleanupAt: timestamp('cleanup_at'),
    cleanupAttempts: integer('cleanup_attempts').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    finishedAt: timestamp('finished_at'),
  },
  (table) => [
    // A queued job is served by one runner at a time.
    uniqueIndex('runner_reservedJobId_live_unique')
      .on(table.reservedJobId)
      .where(liveRunner),
    index('runner_agentId_live_idx').on(table.agentId).where(liveRunner),
    index('runner_leaseExpiresAt_live_idx')
      .on(table.leaseExpiresAt)
      .where(liveRunner),
    index('runner_cleanupAt_idx')
      .on(table.cleanupAt)
      .where(sql`${table.cleanupAt} is not null`),
    index('runner_forgeAppId_externalRunnerId_idx').on(
      table.forgeAppId,
      table.externalRunnerId,
    ),
  ],
)
