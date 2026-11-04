import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

// What plane limits per plan, each counted across the organizations the
// user is the billing owner of.
export const planLimits = ['organizations', 'agents', 'forgeApps'] as const
export type PlanLimit = (typeof planLimits)[number]

// The plans users can subscribe to, read by the Stripe plugin (see
// `billing/plans.ts`) only while billing is on. The default plan is the one
// users without a subscription are on: it has no prices, and there's exactly
// one. Paid plans have a monthly price, and optionally a yearly one. A
// disabled plan can't be subscribed to, but its subscribers keep it. Limits
// are maximums, none meaning unlimited. Plans are shown by `position`,
// lowest first.
export const plan = pgTable(
  'plan',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    monthlyPriceId: text('monthly_price_id'),
    yearlyPriceId: text('yearly_price_id'),
    enabled: boolean('enabled').default(true).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    maxOrganizations: integer('max_organizations'),
    maxAgents: integer('max_agents'),
    maxForgeApps: integer('max_forge_apps'),
    position: integer('position').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('plan_name_unique').on(table.name),
    unique('plan_monthly_price_id_unique').on(table.monthlyPriceId),
    unique('plan_yearly_price_id_unique').on(table.yearlyPriceId),
    uniqueIndex('plan_default_unique')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
    check(
      'plan_prices',
      sql`case when ${table.isDefault}
        then ${table.monthlyPriceId} is null and ${table.yearlyPriceId} is null
        else ${table.monthlyPriceId} is not null end`,
    ),
    check(
      'plan_limits_non_negative',
      sql`coalesce(${table.maxOrganizations}, 0) >= 0
        and coalesce(${table.maxAgents}, 0) >= 0
        and coalesce(${table.maxForgeApps}, 0) >= 0`,
    ),
  ],
)

// Plane's side of an organization (better-auth owns `organization`): the
// user whose plan it counts against, its creator; whether it's their
// personal organization, which counts towards their plan but is never
// disabled; and since when it's disabled for being past their plan's organization limit (read-only, its
// agents and forge apps stopped). Deleting the billing owner deletes the
// organization (see `organizations.service`).
export const organizationBilling = pgTable(
  'organization_billing',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    personal: boolean('personal').default(false).notNull(),
    disabledAt: timestamp('disabled_at'),
  },
  (table) => [index('organization_billing_userId_idx').on(table.userId)],
)

// Every Stripe price a plan was ever given, current or replaced: what
// tells which plan a subscription is on, since subscribers stay on the
// price they paid. A price never moves to another plan: a deleted plan's
// prices stay reserved, without a plan.
export const planPrice = pgTable(
  'plan_price',
  {
    priceId: text('price_id').primaryKey(),
    planId: text('plan_id').references(() => plan.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('plan_price_planId_idx').on(table.planId)],
)
