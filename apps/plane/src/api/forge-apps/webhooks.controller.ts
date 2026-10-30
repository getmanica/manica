import { Elysia, t } from 'elysia'
import { forgeWebhooksService } from './webhooks.service'

export const forgeWebhooksController = new Elysia({
  prefix: '/forge-apps',
}).post(
  '/:id/webhooks',
  // Signatures are computed over the raw body.
  { parse: 'text', body: t.String() },
  async ({ params, body, request: { headers }, status }) => {
    await forgeWebhooksService.receive({ appId: params.id, headers, body })
    return status(204)
  },
)
