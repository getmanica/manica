import { eq } from 'drizzle-orm'
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

    // In order, so a delivery carrying several events for one job applies
    // them as sent.
    for (const event of events) await jobsService.record(app, event)
  },
}
