import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { jwt, organization } from 'better-auth/plugins'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import * as schema from '../platform/db/schema'
import { env } from '../platform/env'
import { pinnedFetch } from '../platform/pinned-fetch'

// What MCP clients may ask for: who the user is, staying connected, and
// reading or managing the organization the user picks when connecting them.
export const mcpScopes = {
  read: 'plane:read',
  write: 'plane:write',
} as const

// The MCP server's resource identifier: tokens are issued for it alone.
export const mcpResource = `${env.betterAuthUrl}/mcp`

// When an access token was issued, in milliseconds: JWTs' `iat` counts
// whole seconds, too coarse to tell tokens issued just before the user
// consented again from those issued after (see `api/mcp`).
export const mcpIssuedAtClaim = 'plane_iat_ms'

// How OAuth codes and opaque tokens are stored: hashed, as better-auth does
// by default, but with a hash plane knows, so it can tell a code it was just
// handed among the stored ones (see `api/mcp`).
export const hashOAuthToken = (token: string) =>
  new Bun.CryptoHasher('sha256').update(token).digest('base64url')

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: env.githubSignIn ? { github: env.githubSignIn } : {},
  user: {
    // Plane sends no email, so an address can only change while it's
    // unverified: GitHub's verified ones stay as GitHub gave them.
    changeEmail: { enabled: true, updateEmailWithoutVerification: true },
    deleteUser: {
      enabled: true,
      // Memberships go with the user; organizations nobody else is in would
      // be left unreachable, so they go too.
      beforeDelete: (user) => organizationsService.deleteSoleOwned(user.id),
    },
  },
  plugins: [
    organization(),
    // Passkeys are tied to the console's host (the relying party), from
    // `BETTER_AUTH_URL`.
    passkey({ rpName: 'Manica', origin: new URL(env.betterAuthUrl).origin }),
    // Signs MCP access tokens, and publishes the keys (`/jwks`) they're
    // checked with. Sessions stay cookie-based: no JWT header on them.
    jwt({ disableSettingJwtHeader: true }),
    // The OAuth 2.1 authorization server MCP clients connect through (see
    // `api/mcp`). Consent picks the organization the client acts in.
    mcp({
      resource: mcpResource,
      loginPage: '/login',
      consentPage: '/consent',
      scopes: [
        'openid',
        'profile',
        'offline_access',
        mcpScopes.read,
        mcpScopes.write,
      ],
      // Access tokens are checked without the database, so a revoked one
      // works until it expires: keep them short, clients refresh them.
      accessTokenExpiresIn: 5 * 60,
      customAccessTokenClaims: () => ({ [mcpIssuedAtClaim]: Date.now() }),
      storeTokens: { hash: hashOAuthToken },
      // Tokens always act as a user: no client credentials grant.
      grantTypes: ['authorization_code', 'refresh_token'],
      // Clients that don't publish a metadata document (Cursor, older Claude
      // Code) register themselves instead.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'infer',
    }),
    // Clients identified by the URL of their metadata document, fetched
    // through a transport that can't be aimed at private addresses.
    cimd({
      fetchClientMetadataResource: pinnedFetch,
      metadataProfile: 'mcp-2026-07-28',
    }),
  ],
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

// How users can sign in, for the sign-in page to offer.
export const signInMethods = () => ({ github: !!env.githubSignIn })
