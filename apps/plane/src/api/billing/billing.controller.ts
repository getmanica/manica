import { Elysia, t } from 'elysia'
import { authMacro } from '../auth/session'
import { planLimits } from '../platform/db/schema'
import { billingService } from './billing.service'
import { limitsService } from './limits'

// The signed-in user's billing (see `billing.service`). Subscribing goes
// through the Stripe plugin's checkout (`/api/auth/subscription/upgrade`);
// changing plans, managing payment and cancelling, through plane.
export const billingController = new Elysia({ prefix: '/billing' })
  .use(authMacro)
  .get('/', { auth: true }, ({ user }) => billingService.summary(user.id))
  .post('/portal', { auth: true }, ({ user }) =>
    billingService.portalUrl(user.id),
  )
  .post(
    '/plan',
    {
      auth: true,
      body: t.Object({
        plan: t.String({ minLength: 1, maxLength: 64 }),
        annual: t.Boolean(),
      }),
    },
    async ({ user, body, status }) => {
      const error = await billingService.changePlan(
        user.id,
        body.plan,
        body.annual,
      )
      return error ?? status(204)
    },
  )
  .post(
    '/swap',
    {
      auth: true,
      body: t.Object({
        kind: t.UnionEnum(planLimits),
        enable: t.String({ minLength: 1, maxLength: 64 }),
        disable: t.String({ minLength: 1, maxLength: 64 }),
      }),
    },
    async ({ user, body: { kind, ...ids }, status }) => {
      const error = await limitsService.swap(user.id, kind, ids)
      return error ?? status(204)
    },
  )
