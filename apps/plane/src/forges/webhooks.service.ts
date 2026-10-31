import { eq } from 'drizzle-orm'
import { decrypt } from '../crypto'
import { db } from '../db'
import { forgeApp } from '../db/schema'
import { ForgeAppNotFoundError } from './errors'
import type { ForgeSecrets } from './forge'
import { forges } from './registry'

export const forgeWebhooksService = {
  async receive(input: { appId: string; headers: Headers; body: string }) {
    const [app] = await db
      .select({ forge: forgeApp.forge, secrets: forgeApp.secrets })
      .from(forgeApp)
      .where(eq(forgeApp.id, input.appId))
    if (!app) throw new ForgeAppNotFoundError()

    const secrets = JSON.parse(await decrypt(app.secrets)) as ForgeSecrets
    const events = await forges[app.forge].receive({
      headers: input.headers,
      body: input.body,
      secrets,
    })

    // Dispatching jobs to runners comes later.
    for (const event of events) {
      console.log(`[${app.forge}] ${event.type}`, event)
    }
  },
}
