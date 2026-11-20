import { Elysia, t } from 'elysia'
import { userSorts } from '../../shared/pagination'
import { authMacro } from '../auth/session'
import { grantsService } from '../billing/grants.service'
import { listQuery } from '../platform/pagination'
import { adminUsersService } from './users.service'

// The plane's users, for its admins. Their role, unbanning them and their
// sessions go through the admin plugin's endpoints (`/api/auth/admin/*`),
// which check the same role; banning and removing them take more than one
// write, done here in one transaction. Granting them a plan is here too.
export const adminUsersController = new Elysia({ prefix: '/admin/users' })
  .use(authMacro)
  .get(
    '/',
    { admin: true, query: t.Object(listQuery(userSorts)) },
    ({ query }) => adminUsersService.list(query),
  )
  .delete('/:id', { admin: true }, ({ user, params: { id } }) =>
    adminUsersService.remove(user.id, id),
  )
  .post(
    '/:id/ban',
    {
      admin: true,
      body: t.Object({
        reason: t.Optional(t.String({ maxLength: 200 })),
        // Seconds, up to ten years; until unbanned without.
        expiresIn: t.Optional(
          t.Integer({ minimum: 1, maximum: 10 * 365 * 24 * 60 * 60 }),
        ),
      }),
    },
    ({ user, params: { id }, body }) =>
      adminUsersService.ban(user.id, id, body),
  )
  .put(
    '/:id/grant',
    {
      admin: true,
      body: t.Object({
        planId: t.String({ minLength: 1, maxLength: 64 }),
        // Seconds, up to ten years; for good without.
        expiresIn: t.Optional(
          t.Integer({ minimum: 1, maximum: 10 * 365 * 24 * 60 * 60 }),
        ),
        reason: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
    ({ user, params: { id }, body }) =>
      adminUsersService.grantPlan(user.id, id, body),
  )
  .delete('/:id/grant', { admin: true }, async ({ params: { id }, status }) => {
    const error = await grantsService.revoke(id)
    return error ?? status(204)
  })
