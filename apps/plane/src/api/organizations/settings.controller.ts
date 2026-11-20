import { Elysia, t } from 'elysia'
import { metricsRetentionDays } from '../../shared/organization-settings'
import { authMacro } from '../auth/session'
import { settingsService } from './settings.service'

// The active organization's settings: any member reads them, changing them
// takes the permission to update the organization.
export const settingsController = new Elysia({
  prefix: '/organization/settings',
})
  .use(authMacro)
  .get('/', { organization: true }, ({ organizationId }) =>
    settingsService.get(organizationId),
  )
  .patch(
    '/',
    {
      permission: { organization: ['update'] },
      body: t.Object(
        {
          metricsRetentionDays: t.Optional(
            t.Integer({
              minimum: metricsRetentionDays.min,
              maximum: metricsRetentionDays.max,
            }),
          ),
        },
        { minProperties: 1 },
      ),
    },
    ({ organizationId, body }) => settingsService.update(organizationId, body),
  )
