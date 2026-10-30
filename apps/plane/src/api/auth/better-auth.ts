import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import * as schema from '../platform/db/schema'
import { env } from '../platform/env'

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
