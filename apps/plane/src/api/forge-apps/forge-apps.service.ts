import { type AnyColumn, and, eq, gt, ilike, or, sql } from 'drizzle-orm'
import type { ForgeAppSort } from '../../shared/pagination'
import { forges } from '../forges/registry'
import { encrypt } from '../platform/crypto'
import { db } from '../platform/db'
import type { ForgeKind } from '../platform/db/schema'
import { forgeApp, forgeAppSetup } from '../platform/db/schema'
import {
  containing,
  filterText,
  type ListOptions,
  pageWindow,
  sortBy,
} from '../platform/pagination'
import { ForgeAppNotFoundError, ForgeAppSetupInvalidError } from './errors'

// Forges expire their setup codes after an hour (GitHub's manifest codes do).
const SETUP_TTL_MS = 60 * 60 * 1000

const publicColumns = {
  id: forgeApp.id,
  forge: forgeApp.forge,
  externalId: forgeApp.externalId,
  slug: forgeApp.slug,
  name: forgeApp.name,
  url: forgeApp.url,
  installUrl: forgeApp.installUrl,
  owner: forgeApp.owner,
  lastDeliveryAt: forgeApp.lastDeliveryAt,
  createdAt: forgeApp.createdAt,
}

const toPublic = ({
  secrets: _,
  organizationId: __,
  createdById: ___,
  updatedAt: ____,
  deliveriesCheckedAt: _____,
  ...app
}: typeof forgeApp.$inferSelect) => app

const sorts: Record<ForgeAppSort, AnyColumn> = {
  name: forgeApp.name,
  owner: forgeApp.owner,
  status: forgeApp.lastDeliveryAt,
  createdAt: forgeApp.createdAt,
}

export const forgeAppsService = {
  // A page of the organization's forge apps, newest first unless sorted
  // otherwise: only those whose name, slug, account or forge contain the
  // filter text.
  async list(
    organizationId: string,
    {
      sort = 'createdAt',
      dir = 'desc',
      ...options
    }: ListOptions<ForgeAppSort> = {},
  ) {
    const text = filterText(options.q)
    const pattern = text && containing(text)
    const where = and(
      eq(forgeApp.organizationId, organizationId),
      pattern
        ? or(
            ilike(forgeApp.name, pattern),
            ilike(forgeApp.slug, pattern),
            ilike(forgeApp.owner, pattern),
            ilike(sql`${forgeApp.forge}::text`, pattern),
          )
        : undefined,
    )
    const { limit, offset } = pageWindow(options)

    const [items, total] = await Promise.all([
      db
        .select(publicColumns)
        .from(forgeApp)
        .where(where)
        .orderBy(...sortBy(sorts[sort], dir, forgeApp.id))
        .limit(limit)
        .offset(offset),
      db.$count(forgeApp, where),
    ])
    return { items, total }
  },

  async get(organizationId: string, id: string) {
    const [app] = await db
      .select(publicColumns)
      .from(forgeApp)
      .where(
        and(eq(forgeApp.id, id), eq(forgeApp.organizationId, organizationId)),
      )
    return app ?? new ForgeAppNotFoundError()
  },

  async startSetup(input: {
    forge: ForgeKind
    organizationId: string
    userId: string
    owner?: string
  }) {
    const appId = crypto.randomUUID()
    const state = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString('base64url')

    // Built first: the forge may refuse to set up an app at all.
    const redirect = forges[input.forge].setup({
      appId,
      state,
      owner: input.owner,
    })

    await db.insert(forgeAppSetup).values({
      state,
      appId,
      forge: input.forge,
      organizationId: input.organizationId,
      userId: input.userId,
      expiresAt: new Date(Date.now() + SETUP_TTL_MS),
    })

    return { forge: input.forge, redirect }
  },

  // The setup is consumed even if the forge rejects the code: codes are
  // single use, so a retry has to start over.
  async completeSetup(input: { userId: string; state: string; code: string }) {
    const [setup] = await db
      .delete(forgeAppSetup)
      .where(
        and(
          eq(forgeAppSetup.state, input.state),
          eq(forgeAppSetup.userId, input.userId),
          gt(forgeAppSetup.expiresAt, new Date()),
        ),
      )
      .returning()
    if (!setup) throw new ForgeAppSetupInvalidError()

    const { secrets, ...registered } = await forges[setup.forge].complete({
      code: input.code,
    })

    const [app] = await db
      .insert(forgeApp)
      .values({
        ...registered,
        id: setup.appId,
        forge: setup.forge,
        secrets: await encrypt(JSON.stringify(secrets)),
        organizationId: setup.organizationId,
        createdById: setup.userId,
      })
      .returning()
    if (!app) throw new Error('Failed to insert forge app')
    return toPublic(app)
  },
}
