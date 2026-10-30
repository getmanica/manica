import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  pgEnum,
  pgTable,
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
