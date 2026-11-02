import { Elysia } from 'elysia'
import {
  ForbiddenError,
  NoActiveOrganizationError,
  NotAMemberError,
  UnauthorizedError,
} from '../errors'
import { auth } from './better-auth'
import { can, memberRole, type Permissions } from './principal'

// Authentication for the console API: the browser's better-auth session.

export type { Permissions }

// For routes that handle their own failures instead of using the macros.
export const requireSession = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers })
  if (!session) throw new UnauthorizedError()
  return session
}

// The signed-in member and the session's active organization, or why the
// request can't act in it.
const organizationSession = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers })
  if (!session) return new UnauthorizedError()
  const organizationId = session.session.activeOrganizationId
  if (!organizationId) return new NoActiveOrganizationError()
  // better-auth leaves a removed member's sessions pointing at the
  // organization, so membership is checked on every request.
  const principal = { userId: session.user.id, organizationId }
  if (!(await memberRole(principal))) return new NotAMemberError()
  return { user: session.user, session: session.session, organizationId }
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
      const context = await organizationSession(headers)
      if (context instanceof UnauthorizedError) return status(401)
      return context
    },
  },
  // Like `organization`, also requiring the member's role to grant the
  // permissions.
  permission: (permissions: Permissions) => ({
    derive: async ({ status, request: { headers } }) => {
      const context = await organizationSession(headers)
      if (context instanceof UnauthorizedError) return status(401)
      if (context instanceof Error) return context
      const principal = {
        userId: context.user.id,
        organizationId: context.organizationId,
      }
      if (!(await can(principal, permissions))) return new ForbiddenError()
      return context
    },
  }),
})
