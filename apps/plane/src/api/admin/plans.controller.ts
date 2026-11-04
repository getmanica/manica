import { Elysia, t } from 'elysia'
import { authMacro } from '../auth/session'
import { plansService } from '../billing/plans.service'
import { env } from '../platform/env'

const limit = t.Nullable(t.Integer({ minimum: 0, maximum: 1_000_000 }))
const priceId = t.Nullable(t.String({ maxLength: 255 }))

const fields = {
  name: t.String({ minLength: 1, maxLength: 64 }),
  description: t.String({ maxLength: 500 }),
  monthlyPriceId: priceId,
  yearlyPriceId: priceId,
  enabled: t.Boolean(),
  maxOrganizations: limit,
  maxAgents: limit,
  maxForgeApps: limit,
}

// The plans users subscribe to, for the plane's admins (see `api/billing`).
// Manageable with billing off too, to set them up before turning it on.
export const adminPlansController = new Elysia({ prefix: '/admin/plans' })
  .use(authMacro)
  .get('/', { admin: true }, async () => ({
    billing: !!env.stripe,
    items: await plansService.list(),
  }))
  .post(
    '/',
    {
      admin: true,
      body: t.Object({
        name: fields.name,
        description: t.Optional(fields.description),
        monthlyPriceId: t.Optional(fields.monthlyPriceId),
        yearlyPriceId: t.Optional(fields.yearlyPriceId),
        enabled: t.Optional(fields.enabled),
        maxOrganizations: t.Optional(fields.maxOrganizations),
        maxAgents: t.Optional(fields.maxAgents),
        maxForgeApps: t.Optional(fields.maxForgeApps),
      }),
    },
    ({ body }) => plansService.create(body),
  )
  .put(
    '/order',
    {
      admin: true,
      body: t.Object({
        ids: t.Array(t.String({ maxLength: 64 }), { maxItems: 1000 }),
      }),
    },
    async ({ body: { ids }, status }) => {
      const error = await plansService.reorder(ids)
      return error ?? status(204)
    },
  )
  .patch(
    '/:id',
    {
      admin: true,
      body: t.Partial(t.Object(fields), { minProperties: 1 }),
    },
    ({ params: { id }, body }) => plansService.update(id, body),
  )
  .delete('/:id', { admin: true }, async ({ params: { id }, status }) => {
    const error = await plansService.delete(id)
    return error ?? status(204)
  })
