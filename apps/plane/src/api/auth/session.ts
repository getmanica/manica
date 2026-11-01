import { and, eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import {
  ForbiddenError,
  NoActiveOrganizationError,
  NotAMemberError,
  UnauthorizedError,
} from '../errors'
import { db } from '../platform/db'
import { member } from '../platform/db/schema'
import { auth } from './better-auth'

// Authentication for the console API: the browser's better-auth session.

// For routes that handle their own failures instead of using the macros.
export const requireSession = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers })
  if (!session) throw new UnauthorizedError()
  return session
}

type PermissionCheck = NonNullable<
  Parameters<typeof auth.api.hasPermission>[0]
>['body']

// Throws unless the signed-in member's role in their active organization
// grants the checked permissions.
export const assertPermission = async (
  headers: Headers,
  body: PermissionCheck,
) => {
  const { success } = await auth.api.hasPermission({ headers, body })
  if (!success) throw new ForbiddenError()
}

export const authMacro = new Elysia({ name: 'auth' }).macro({
  auth: {
    derive: async ({ status, request: { headers } }) => {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401)
      return { user: session.user, session: session.session }
    },
  },
  // Like `auth`, also requiring an active organization.
  organization: {
    derive: async ({ status, request: { headers } }) => {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401)
      const organizationId = session.session.activeOrganizationId
      if (!organizationId) throw new NoActiveOrganizationError()
      // better-auth leaves a removed member's sessions pointing at the
      // organization, so membership is checked on every request.
      const [membership] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.userId, session.user.id),
            eq(member.organizationId, organizationId),
          ),
        )
        .limit(1)
      if (!membership) throw new NotAMemberError()
      return { user: session.user, session: session.session, organizationId }
    },
  },
})
