import { and, asc, eq, lt, ne } from 'drizzle-orm'
import { db } from '../db'
import { forgeApp, job } from '../db/schema'
import { appContext } from '../forges/context'
import type { Forge, ForgeKind } from '../forges/forge'
import { jobsService } from './jobs.service'

const MINUTE = 60 * 1000

// Deliveries are looked for since the last check, overlapping it a little
// for deliveries still in flight then. An app checked for the first time
// has nothing to catch up on from before the last hour; forges don't keep
// deliveries forever either (GitHub, 3 days).
const DELIVERIES_OVERLAP_MS = 5 * MINUTE
const FIRST_LOOKBACK_MS = 60 * MINUTE
const MAX_LOOKBACK_MS = 3 * 24 * 60 * MINUTE

// A job the plane heard nothing about for this long is checked with the
// forge, a batch at a time.
const STALE_AFTER_MS = 10 * MINUTE
const STALE_BATCH = 50

// Catches up on what webhooks missed, since a forge may not retry a delivery
// the plane failed to receive (GitHub doesn't).
export const createReconciler = (forges: Record<ForgeKind, Forge>) => ({
  // Asks each app's forge to resend the deliveries the plane missed.
  async redeliverFailed(now = new Date()) {
    const apps = await db.select().from(forgeApp)
    for (const app of apps) {
      const since = new Date(
        Math.max(
          app.deliveriesCheckedAt
            ? app.deliveriesCheckedAt.getTime() - DELIVERIES_OVERLAP_MS
            : now.getTime() - FIRST_LOOKBACK_MS,
          now.getTime() - MAX_LOOKBACK_MS,
        ),
      )
      try {
        const count = await forges[app.forge].redeliverFailed({
          app: await appContext(app),
          since,
        })
        if (count > 0) {
          console.log(`asked ${app.forge} to redeliver ${count} deliveries`)
        }
        await db
          .update(forgeApp)
          .set({ deliveriesCheckedAt: now })
          .where(eq(forgeApp.id, app.id))
      } catch (error) {
        console.error(`checking ${app.id}'s deliveries failed:`, error)
      }
    }
  },

  // Refreshes jobs that haven't finished and that the plane hasn't heard
  // about in a while, from what their forge says. The forge has the last
  // word: a job it no longer has is done.
  async resyncStale() {
    const now = new Date()
    const stale = await db
      .select({ job, app: forgeApp })
      .from(job)
      .innerJoin(forgeApp, eq(job.forgeAppId, forgeApp.id))
      .where(
        and(
          ne(job.status, 'completed'),
          lt(job.updatedAt, new Date(now.getTime() - STALE_AFTER_MS)),
        ),
      )
      .orderBy(asc(job.updatedAt))
      .limit(STALE_BATCH)

    for (const { job: stored, app } of stale) {
      try {
        const event = await forges[app.forge].getJob({
          app: await appContext(app),
          installationId: stored.installationId,
          repository: stored.repository,
          externalId: stored.externalId,
        })
        if (event) {
          await jobsService.record(app, event)
        } else {
          await db
            .update(job)
            .set({ status: 'completed', completedAt: now })
            .where(eq(job.id, stored.id))
        }
      } catch (error) {
        console.error(`resyncing job ${stored.id} failed:`, error)
      }
    }
  },
})
