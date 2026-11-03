import { Elysia, t } from 'elysia'
import { userSorts } from '../../shared/pagination'
import { authMacro } from '../auth/session'
import { listQuery } from '../platform/pagination'
import { adminUsersService } from './users.service'

// The plane's users, for its admins. Their role, unbanning them and their
// sessions go through the admin plugin's endpoints (`/api/auth/admin/*`),
// which check the same role; banning and removing them take more than one
// write, done here in one transaction.
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
