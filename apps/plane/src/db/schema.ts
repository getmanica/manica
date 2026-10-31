import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { agentArches, agentOses } from '../agents/platform'
import { type ForgeKind, jobStatuses } from '../forges/forge'
import { liveStates, runnerStates } from '../runners/states'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at')
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    createdAt: timestamp('created_at').notNull(),
    metadata: text('metadata'),
  },
  (table) => [index('organization_slug_idx').on(table.slug)],
)

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId),
  ],
)

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

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
// webhook deliveries it missed (see `reconciler`).
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

export const agentOs = pgEnum('agent_os', agentOses)
export const agentArch = pgEnum('agent_arch', agentArches)

// A machine running the Manica agent, owned by an organization. Only a
// SHA-256 hash of the agent's token is stored: the token itself is shown
// once, when the agent is created. `lastSeenAt` is set by the agent once it
// connects. `slots` is how many jobs it runs at once; `labels` are the
// runs-on labels it answers to on top of the built-in ones (see
// `agents/labels`), stored lowercased.
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

export const runnerState = pgEnum('runner_state', runnerStates)

const liveRunner = sql.raw(
  `"state" in (${liveStates.map((state) => `'${state}'`).join(', ')})`,
)

// A just-in-time runner registered for one of an agent's slots (see
// `runners/states`). It's registered on one repository through one
// installation, with `labels`: GitHub may hand it any job those labels
// cover. `reservedJobId` is the queued job it was registered for, until it
// starts one; `jobId` is the job it actually ran. `leaseExpiresAt` is
// renewed by the agent's polls. `cleanupAt` is when to next try to
// unregister it from the forge, if that's still to do.
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
