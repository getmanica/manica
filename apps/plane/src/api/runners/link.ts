import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../platform/db'
import { runner } from '../platform/db/schema'

// The forge says one of the app's runners picked up `jobId`. GitHub hands a
// runner any queued job its labels cover, so it may not be the job it was
// reserved for: that one is then free for another runner. The runner is
// matched by its forge id, within the app and repository it was registered
// on.
export const linkStartedRunner = async (
  app: { id: string },
  jobId: string,
  event: { repository: string; externalRunnerId: string | null },
) => {
  if (!event.externalRunnerId) return
  await db
    .update(runner)
    .set({
      jobId,
      reservedJobId: null,
      state: sql`case when ${runner.state} in ('issued', 'acked') then 'running'::runner_state else ${runner.state} end`,
    })
    .where(
      and(
        eq(runner.forgeAppId, app.id),
        eq(runner.repository, event.repository),
        eq(runner.externalRunnerId, event.externalRunnerId),
        isNull(runner.jobId),
      ),
    )
}
