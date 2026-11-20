import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'
import { agentArches, agentOses } from '../../../../shared/platform'
import { organization, user } from './auth'

export const agentOs = pgEnum('agent_os', agentOses)
export const agentArch = pgEnum('agent_arch', agentArches)

// A machine running the Manica agent, owned by an organization. Only a
// SHA-256 hash of the agent's token is stored: the token itself is shown
// once, when the agent is created. `lastSeenAt` is set by the agent once it
// connects, and `version` to the agent version it last reported. `slots` is how many jobs it runs at once; `labels` are the
// runs-on labels it answers to on top of the built-in ones (see
// `shared/labels`), stored lowercased.
// `disabledAt` is set while the agent is past its billing owner's plan limit
// (see `billing/limits.ts`): it's handed no jobs.
export const agent = pgTable(
  'agent',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    os: agentOs('os').notNull(),
    arch: agentArch('arch').notNull(),
    slots: integer('slots').default(1).notNull(),
    labels: text('labels').array().default([]).notNull(),
    lastSeenAt: timestamp('last_seen_at'),
    version: text('version'),
    disabledAt: timestamp('disabled_at'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('agent_organizationId_name_unique').on(
      table.organizationId,
      table.name,
    ),
    check('agent_slots_positive', sql`${table.slots} > 0`),
  ],
)

// A reading of an agent machine's resources, which agents report with their
// polls when enabled in their config. `cpu` is the busy fraction (0 to 1) of
// all its cores since its previous reading; the rest are bytes, disk being the
// volume of the agent's data directory. Readings past their retention are
// pruned (see `agents/metrics.service.ts`).
export const agentMetric = pgTable(
  'agent_metric',
  {
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    recordedAt: timestamp('recorded_at').notNull(),
    cpu: real('cpu').notNull(),
    memoryUsed: bigint('memory_used', { mode: 'number' }).notNull(),
    memoryTotal: bigint('memory_total', { mode: 'number' }).notNull(),
    diskUsed: bigint('disk_used', { mode: 'number' }).notNull(),
    diskTotal: bigint('disk_total', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.recordedAt] }),
    index('agent_metric_recordedAt_idx').on(table.recordedAt),
  ],
)
