import { runMigrations } from './api/platform/db'
import { env } from './api/platform/env'
import { every } from './api/platform/scheduler'
import web from './web/index.html'

await runMigrations()

// Loaded once the schema is current: setting up better-auth's Stripe plugin
// reads the plans (see `api/auth/better-auth.ts`).
const { app } = await import('./api/app')
const { billingService } = await import('./api/billing/billing.service')
const { limitsService } = await import('./api/billing/limits')
const { forges } = await import('./api/forges/registry')
const { createReconciler } = await import('./api/jobs/reconciler')
const { reaper } = await import('./api/runners')
const { runReaper } = await import('./api/runners/reaper')

const reconciler = createReconciler(forges)
every('redeliver-failed-webhooks', 5 * 60 * 1000, () =>
  reconciler.redeliverFailed(),
)
every('resync-stale-jobs', 60 * 1000, () => reconciler.resyncStale())
every('reap-runners', 15 * 1000, () => runReaper(reaper))
// Catches up on plan changes a missed Stripe webhook would have applied, and
// with billing off, enables what an earlier plan disabled.
every('reconcile-plan-limits', 15 * 60 * 1000, () =>
  limitsService.reconcileAll(),
)
// Catches up on subscription changes whose webhook the plane failed to
// apply, from Stripe itself.
if (env.stripe) {
  every('sync-stripe-subscriptions', 60 * 60 * 1000, () =>
    billingService.syncFromStripe(),
  )
}

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
