import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
} from 'drizzle-orm'
import { db } from '../db'
import { forgeApp, job, runner } from '../db/schema'
import { appContext } from '../forges/context'
import type { Forge, ForgeKind } from '../forges/forge'
import { liveStates, runnerName } from './states'

const SECOND = 1000
const MINUTE = 60 * SECOND

// A runner registered for a job that no longer needs it is given this long
// for the forge to report that it picked up another job, before it's retired.
const IDLE_GRACE_MS = 30 * SECOND

// Unregistering is retried with backoff, then given up on: forges drop
// offline just-in-time runners on their own eventually (GitHub, within a
// day).
const CLEANUP_BATCH = 50
const CLEANUP_MAX_BACKOFF_MS = 10 * MINUTE
const CLEANUP_GIVE_UP_MS = 24 * 60 * MINUTE

const backoff = (attempts: number) =>
  Math.min(30 * SECOND * 2 ** attempts, CLEANUP_MAX_BACKOFF_MS)

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// Housekeeping for runners: what agents' polls and the forge's webhooks
// leave to time.
export const createReaper = (forges: Record<ForgeKind, Forge>) => {
  const scopeOf = async (
    stored: typeof runner.$inferSelect,
    app: typeof forgeApp.$inferSelect,
  ) => ({
    app: await appContext(app),
    installationId: stored.installationId,
    repository: stored.repository,
  })

  return {
    // Gives up on runners whose agent went silent. One running a job is
    // lost (the forge fails the job in time); any other is released, so
    // its job gets another runner.
    async expireLeases(now = new Date()) {
      const expired = and(
        inArray(runner.state, liveStates),
        lt(runner.leaseExpiresAt, now),
      )
      await db
        .update(runner)
        .set({ state: 'lost', finishedAt: now, cleanupAt: now })
        .where(and(expired, eq(runner.state, 'running')))
      await db
        .update(runner)
        .set({ state: 'released', finishedAt: now, cleanupAt: now })
        .where(and(expired, ne(runner.state, 'running')))
    },

    // Retires registered runners whose job no longer needs them: it was
    // cancelled, or another runner picked it up. A runner that picked up
    // another job meanwhile can't be unregistered, and is left be.
    async retireIdle(now = new Date()) {
      const idle = await db
        .select({ runner, app: forgeApp })
        .from(runner)
        .innerJoin(forgeApp, eq(runner.forgeAppId, forgeApp.id))
        .leftJoin(job, eq(runner.reservedJobId, job.id))
        .where(
          and(
            inArray(runner.state, ['issued', 'acked']),
            isNull(runner.jobId),
            isNotNull(runner.externalRunnerId),
            // Polls renew the runner itself: the grace counts from when its
            // job stopped being queued.
            or(
              isNull(job.id),
              and(
                ne(job.status, 'queued'),
                lt(job.updatedAt, new Date(now.getTime() - IDLE_GRACE_MS)),
              ),
            ),
          ),
        )
      for (const { runner: stored, app } of idle) {
        try {
          const result = await forges[app.forge].deleteRunner({
            ...(await scopeOf(stored, app)),
            externalRunnerId: stored.externalRunnerId ?? '',
          })
          if (result === 'busy') continue
          // Its agent is told to stop it on its next poll.
          await db
            .update(runner)
            .set({ state: 'released', finishedAt: now })
            .where(
              and(
                eq(runner.id, stored.id),
                inArray(runner.state, ['issued', 'acked']),
              ),
            )
        } catch (error) {
          console.error(
            `retiring runner ${stored.id} failed: ${describe(error)}`,
          )
        }
      }
    },

    // Unregisters runners the plane is done with from their forge.
    async cleanup(now = new Date()) {
      const due = await db
        .select({ runner, app: forgeApp })
        .from(runner)
        .innerJoin(forgeApp, eq(runner.forgeAppId, forgeApp.id))
        .where(lte(runner.cleanupAt, now))
        .orderBy(asc(runner.cleanupAt))
        .limit(CLEANUP_BATCH)

      for (const { runner: stored, app } of due) {
        const done = () =>
          db
            .update(runner)
            .set({ cleanupAt: null })
            .where(eq(runner.id, stored.id))
        if (now.getTime() - stored.createdAt.getTime() > CLEANUP_GIVE_UP_MS) {
          await done()
          continue
        }
        try {
          const forge = forges[app.forge]
          const scope = await scopeOf(stored, app)
          // A registration whose outcome wasn't known is looked up by name.
          const externalRunnerId =
            stored.externalRunnerId ??
            (await forge.findRunner({ ...scope, name: runnerName(stored.id) }))
          const result = externalRunnerId
            ? await forge.deleteRunner({ ...scope, externalRunnerId })
            : 'deleted'
          if (result === 'deleted') {
            await done()
            continue
          }
        } catch (error) {
          console.error(
            `unregistering runner ${stored.id} failed: ${describe(error)}`,
          )
        }
        await db
          .update(runner)
          .set({
            cleanupAt: new Date(
              now.getTime() + backoff(stored.cleanupAttempts),
            ),
            cleanupAttempts: stored.cleanupAttempts + 1,
          })
          .where(eq(runner.id, stored.id))
      }
    },
  }
}

export const runReaper = async (reaper: ReturnType<typeof createReaper>) => {
  await reaper.expireLeases()
  await reaper.retireIdle()
  await reaper.cleanup()
}
