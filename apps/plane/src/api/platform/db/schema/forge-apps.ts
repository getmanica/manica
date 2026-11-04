import { index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { KnownForgeKind } from 'forges'
import { organization, user } from './auth'

// Forges plane can register apps on, named as in `forges`.
export const forgeKinds = ['github'] as const satisfies KnownForgeKind[]
export type ForgeKind = (typeof forgeKinds)[number]

// Pending forge app setups, keyed by the `state` round-tripped through the
// forge. `appId` is reserved up front so the forge can be given the app's
// webhook URL before the app exists. Deleted once the setup completes.
export const forgeAppSetup = pgTable(
  'forge_app_setup',
  {
    state: text('state').primaryKey(),
    appId: text('app_id').notNull(),
    forge: text('forge').$type<ForgeKind>().notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('forge_app_setup_userId_idx').on(table.userId)],
)

// An app registered on a forge (e.g. a GitHub App), owned by an organization.
// `secrets` holds the forge-specific credentials, encrypted at rest.
// `deliveriesCheckedAt` is when plane last asked the forge to resend the
// webhook deliveries it missed (see `jobs/reconciler`). `lastDeliveryAt` is
// when a genuine (signed) webhook delivery last arrived.
// `disabledAt` is set while the app is past its billing owner's plan limit
// (see `billing/limits.ts`): its deliveries are acknowledged and ignored.
export const forgeApp = pgTable(
  'forge_app',
  {
    id: text('id').primaryKey(),
    forge: text('forge').$type<ForgeKind>().notNull(),
    externalId: text('external_id').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    installUrl: text('install_url'),
    owner: text('owner').notNull(),
    secrets: text('secrets').notNull(),
    deliveriesCheckedAt: timestamp('deliveries_checked_at'),
    lastDeliveryAt: timestamp('last_delivery_at'),
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
    unique('forge_app_forge_externalId_unique').on(
      table.forge,
      table.externalId,
    ),
    index('forge_app_organizationId_idx').on(table.organizationId),
  ],
)
