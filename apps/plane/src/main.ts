import { app } from './api/app'
import { forges } from './api/forges/registry'
import { createReconciler } from './api/jobs/reconciler'
import { runMigrations } from './api/platform/db'
import { env } from './api/platform/env'
import { every } from './api/platform/scheduler'
import { reaper } from './api/runners'
import { runReaper } from './api/runners/reaper'
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
    // The MCP server and its OAuth discovery (see `api/mcp`).
    '/mcp': app.fetch,
    '/.well-known/*': app.fetch,
    '/*': web,
  },
})

console.log(`plane listening on ${server.url}`)
