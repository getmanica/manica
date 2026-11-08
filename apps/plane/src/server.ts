// Start's server entry, evaluated as the plane's process starts (`serve.ts`)
// or, in development, on the first request.
import { db } from './api/platform/db'
import { assertMigrated } from './api/platform/db/pending'

// The plane never migrates on its own (see `migrate.ts`): it refuses to
// start on a database missing some. Checked before the app is imported:
// setting up better-auth's Stripe plugin reads the plans.
await assertMigrated(db.$client)

const { default: handler, createServerEntry } = await import(
  '@tanstack/react-start/server-entry'
)
const { startScheduledTasks } = await import('./scheduled')

// In development, an edit evaluates this module again: the tasks then
// restart on the new code instead of running twice.
const globals = globalThis as {
  planeStopScheduledTasks?: () => void
  planeShutdown?: () => Promise<void>
}
globals.planeStopScheduledTasks?.()
globals.planeStopScheduledTasks = startScheduledTasks()

// What `serve.ts` runs once it stopped taking requests, so the process can
// end: no new tasks, and the database's connections closed once their
// queries (a running task's included) finish.
globals.planeShutdown = async () => {
  globals.planeStopScheduledTasks?.()
  await db.$client.end({ timeout: 10 })
}

export default createServerEntry({ fetch: (request) => handler.fetch(request) })
