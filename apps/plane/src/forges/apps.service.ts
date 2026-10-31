import { and, eq, gt } from 'drizzle-orm'
import { encrypt } from '../crypto'
import { db } from '../db'
import { forgeApp, forgeAppSetup } from '../db/schema'
import { ForgeAppSetupInvalidError } from './errors'
import type { ForgeKind } from './forge'
import { forges } from './registry'

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
  createdAt: forgeApp.createdAt,
}

const toPublic = ({
  secrets: _,
  organizationId: __,
  createdById: ___,
  updatedAt: ____,
  ...app
}: typeof forgeApp.$inferSelect) => app

export const forgeAppsService = {
  list: (organizationId: string) =>
    db
      .select(publicColumns)
      .from(forgeApp)
      .where(eq(forgeApp.organizationId, organizationId)),

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
