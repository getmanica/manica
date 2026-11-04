import { eq } from 'drizzle-orm'
import { activeForgeApp } from '../billing/limits'
import { appContext } from '../forges/context'
import { forges } from '../forges/registry'
import { jobsService } from '../jobs/jobs.service'
import { db } from '../platform/db'
import { forgeApp } from '../platform/db/schema'
import { ForgeAppNotFoundError } from './errors'

export const forgeWebhooksService = {
  async receive(input: { appId: string; headers: Headers; body: string }) {
    const [app] = await db
      .select({
        id: forgeApp.id,
        forge: forgeApp.forge,
        externalId: forgeApp.externalId,
        secrets: forgeApp.secrets,
        organizationId: forgeApp.organizationId,
        active: activeForgeApp,
      })
      .from(forgeApp)
      .where(eq(forgeApp.id, input.appId))
    if (!app) throw new ForgeAppNotFoundError()

    const { secrets } = await appContext(app)
    const events = await forges[app.forge].receive({
      headers: input.headers,
      body: input.body,
      secrets,
    })

    // Past the signature check: the forge is reaching the app.
    await db
      .update(forgeApp)
      .set({ lastDeliveryAt: new Date() })
      .where(eq(forgeApp.id, app.id))

    // Disabled past the plan's limit (see `billing/limits.ts`): acknowledged,
    // so the forge doesn't retry, and ignored.
    if (!app.active) return

    // In order, so a delivery carrying several events for one job applies
    // them as sent.
    for (const event of events) await jobsService.record(app, event)
  },
}
