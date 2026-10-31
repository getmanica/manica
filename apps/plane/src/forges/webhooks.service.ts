import { eq } from 'drizzle-orm'
import { db } from '../db'
import { forgeApp } from '../db/schema'
import { jobsService } from '../jobs/jobs.service'
import { appContext } from './context'
import { ForgeAppNotFoundError } from './errors'
import { forges } from './registry'

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
