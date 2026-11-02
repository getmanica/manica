import { Elysia, HTTPError, t } from 'elysia'
import { forgeAppSorts } from '../../shared/pagination'
import { authMacro, requireSession } from '../auth/session'
import { forgeKinds } from '../platform/db/schema'
import { env } from '../platform/env'
import { listQuery } from '../platform/pagination'
import { ForgeAppSetupCallbackInvalidError } from './errors'
import { forgeAppsService } from './forge-apps.service'

// SPA pages the setup callback lands on.
const setupSuccessUrl = (appId: string) =>
  `${env.betterAuthUrl}/forge-apps/setup/success?app=${encodeURIComponent(appId)}`
const setupErrorUrl = (code: string) =>
  `${env.betterAuthUrl}/forge-apps/setup/error?code=${encodeURIComponent(code)}`

export const forgeAppsController = new Elysia({ prefix: '/forge-apps' })
  .use(authMacro)
  .get(
    '/',
    { organization: true, query: t.Object(listQuery(forgeAppSorts)) },
    ({ organizationId, query }) => forgeAppsService.list(organizationId, query),
  )
  // Returns where to send the browser to register the app on the forge.
  .post(
    '/setup',
    {
      permission: { organization: ['update'] },
      body: t.Object({
        forge: t.UnionEnum(forgeKinds),
        owner: t.Optional(t.String({ minLength: 1 })),
      }),
    },
    ({ body, user, organizationId }) =>
      forgeAppsService.startSetup({
        ...body,
        organizationId,
        userId: user.id,
      }),
  )
  // The forge redirects the browser here once the app is registered. Every
  // outcome is a redirect to the SPA, never a JSON error.
  .get(
    '/setup/callback',
    {
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
      }),
    },
    async ({ query: { code, state }, request: { headers }, redirect }) => {
      try {
        if (!code || !state) throw new ForgeAppSetupCallbackInvalidError()
        const { user } = await requireSession(headers)
        const app = await forgeAppsService.completeSetup({
          userId: user.id,
          state,
          code,
        })
        return redirect(setupSuccessUrl(app.id), 303)
      } catch (error) {
        if (error instanceof HTTPError && error.code) {
          return redirect(setupErrorUrl(error.code), 303)
        }
        console.error('forge app setup failed', error)
        return redirect(setupErrorUrl('INTERNAL'), 303)
      }
    },
  )
  .get('/:id', { organization: true }, ({ organizationId, params: { id } }) =>
    forgeAppsService.get(organizationId, id),
  )
