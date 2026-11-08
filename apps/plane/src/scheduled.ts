import { billingService } from './api/billing/billing.service'
import { limitsService } from './api/billing/limits'
import { forges } from './api/forges/registry'
import { createReconciler } from './api/jobs/reconciler'
import { env } from './api/platform/env'
import { every } from './api/platform/scheduler'
import { reaper } from './api/runners'
import { runReaper } from './api/runners/reaper'

// What the plane does on its own, on every instance (each task runs on one
// at a time, see `api/platform/scheduler`). Returns a function that stops it.
export const startScheduledTasks = () => {
  const reconciler = createReconciler(forges)
  const stops = [
    every('redeliver-failed-webhooks', 5 * 60 * 1000, () =>
      reconciler.redeliverFailed(),
    ),
    every('resync-stale-jobs', 60 * 1000, () => reconciler.resyncStale()),
    every('reap-runners', 15 * 1000, () => runReaper(reaper)),
    // Catches up on plan changes a missed Stripe webhook would have applied,
    // and with billing off, enables what an earlier plan disabled.
    every('reconcile-plan-limits', 15 * 60 * 1000, () =>
      limitsService.reconcileAll(),
    ),
  ]
  // Catches up on subscription changes whose webhook the plane failed to
  // apply, from Stripe itself.
  if (env.stripe) {
    stops.push(
      every('sync-stripe-subscriptions', 60 * 60 * 1000, () =>
        billingService.syncFromStripe(),
      ),
    )
  }
  return () => {
    for (const stop of stops) stop()
  }
}
