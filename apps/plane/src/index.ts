import { app } from './app'
import { every } from './background'
import { runMigrations } from './db'
import { env } from './env'
import { forges } from './forges/registry'
import { createReconciler } from './jobs/reconciler'
import { reaper } from './runners'
import { runReaper } from './runners/reaper'
import web from './web/index.html'

await runMigrations()

const reconciler = createReconciler(forges)
every('redeliver-failed-webhooks', 5 * 60 * 1000, () =>
  reconciler.redeliverFailed(),
)
every('resync-stale-jobs', 60 * 1000, () => reconciler.resyncStale())
every('reap-runners', 15 * 1000, () => runReaper(reaper))

const server = Bun.serve({
  port: env.port,
  development: !env.production && { hmr: true, console: true },
  routes: {
    '/api/*': app.fetch,
    '/*': web,
  },
})

console.log(`plane listening on ${server.url}`)
