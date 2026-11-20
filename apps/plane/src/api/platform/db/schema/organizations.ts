import { sql } from 'drizzle-orm'
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { metricsRetentionDays } from '../../../../shared/organization-settings'
import { organization } from './auth'

// An organization's settings, once changed from their defaults: without a
// row, every setting is its default. `metricsRetentionDays` is how long its
// agents' metrics readings are kept (see `agents/metrics.service.ts`).
export const organizationSettings = pgTable(
  'organization_settings',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    metricsRetentionDays: integer('metrics_retention_days')
      .default(metricsRetentionDays.default)
      .notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      'organization_settings_metricsRetentionDays_range',
      sql`${table.metricsRetentionDays} between ${sql.raw(String(metricsRetentionDays.min))} and ${sql.raw(String(metricsRetentionDays.max))}`,
    ),
  ],
)
