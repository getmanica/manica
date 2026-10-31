import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { Elysia } from 'elysia'
import { db } from './db'
import * as schema from './db/schema'
import { env } from './env'
import {
  ForbiddenError,
  NoActiveOrganizationError,
  UnauthorizedError,
} from './errors'
import { organizationsService } from './organizations/organizations.service'

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [organization()],
  databaseHooks: {
    session: {
      create: {
        // Onboarding: sessions always start in an organization, so signing
        // up lands the user in their personal one.
        before: async (session) => ({
          data: {
            ...session,
            activeOrganizationId: await organizationsService.defaultFor(
              session.userId,
            ),
          },
        }),
      },
    },
  },
})

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
      return { user: session.user, session: session.session, organizationId }
    },
  },
})
