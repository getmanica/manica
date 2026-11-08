import { createHash } from 'node:crypto'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { passkey } from '@better-auth/passkey'
import { stripe } from '@better-auth/stripe'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'
import { admin, jwt, organization } from 'better-auth/plugins'
import { defaultAc, userAc } from 'better-auth/plugins/admin/access'
import { and, eq, inArray } from 'drizzle-orm'
import type Stripe from 'stripe'
import { billingService } from '../billing/billing.service'
import {
  AlreadySubscribedError,
  PaymentOverdueError,
  PlanUnavailableError,
  ScheduledChangeError,
} from '../billing/errors'
import { limitsService } from '../billing/limits'
import { plansService } from '../billing/plans.service'
import { stripeApi } from '../billing/stripe'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import * as schema from '../platform/db/schema'
import { env } from '../platform/env'
import { pinnedFetch } from '../platform/pinned-fetch'
import { isBanned, liftExpiredBan, liftsBan } from './bans'

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
  createHash('sha256').update(token).digest('base64url')

// What the plane's admins may do, through the admin plugin's endpoints
// (`/api/auth/admin/*`): see users and their sessions, change their role,
// unban them and sign them out (plane bans and removes them, see
// `api/admin`). Never act as them: no impersonating, nor setting their
// password or email, which would amount to it. Users may do none of it.
const appRoleAccess = {
  admin: defaultAc.newRole({
    user: ['list', 'get', 'set-role', 'ban'],
    session: ['list', 'revoke', 'delete'],
  }),
  user: userAc,
}

// A typed error, as better-auth reports errors.
const refusal = (
  error: { code?: string; detail?: string },
  status:
    | 'FORBIDDEN'
    | 'BAD_REQUEST'
    | 'PAYMENT_REQUIRED'
    | 'BAD_GATEWAY' = 'FORBIDDEN',
) =>
  APIError.from(status, {
    message: error.detail ?? 'Forbidden',
    code: error.code ?? status,
  })

// The billing owners of organizations being deleted, by organization.
const deletingOwners = new Map<string, string>()

// Changes to a disabled organization are refused: it's read-only while past
// its billing owner's plan (see `billing/limits.ts`). Removing members,
// cancelling invitations and deleting it stay possible.
const refuseIfDisabled = async (organizationId: string) => {
  const refused = await limitsService.writable(organizationId)
  if (refused) throw refusal(refused)
}

// A user changing plans while a payment is overdue: Stripe's plugin would
// start a second subscription beside the one it's still collecting.
const overdue = async (userId: string) => {
  const [found] = await db
    .select({ id: schema.subscription.id })
    .from(schema.subscription)
    .where(
      and(
        eq(schema.subscription.referenceId, userId),
        inArray(schema.subscription.status, ['past_due', 'unpaid']),
      ),
    )
    .limit(1)
  return !!found
}

// Billing, on when Stripe is set up: users subscribe themselves to the
// plans in the `plan` table (see `api/billing`). Every change to a
// subscription brings the user's resources in line with their plan.
const billing = (client: Stripe, webhookSecret: string) => {
  const reconcile = async ({
    subscription,
  }: {
    subscription: { referenceId: string }
  }) => {
    await limitsService.reconcile(subscription.referenceId)
  }
  return stripe({
    stripeClient: client,
    stripeWebhookSecret: webhookSecret,
    // Customers are created at checkout: most users never subscribe.
    createCustomerOnSignUp: false,
    subscription: {
      enabled: true,
      plans: () => plansService.forStripe(),
      // Users subscribe for themselves only.
      authorizeReference: async ({ user, referenceId }) =>
        referenceId === user.id,
      onSubscriptionComplete: reconcile,
      onSubscriptionCreated: reconcile,
      onSubscriptionUpdate: reconcile,
      onSubscriptionDeleted: reconcile,
    },
  })
}

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
      // Stripe stops billing the user first: if it can't be reached, nothing
      // is deleted. Memberships go with the user; organizations they're the
      // billing owner of go too, as do those nobody else is in, which would
      // be left unreachable. First, while the user can still sign in:
      // better-auth then drops their sessions and sign-ins, and only last
      // the user, outside any transaction.
      beforeDelete: async (user) => {
        const failed = await billingService
          .cancelAll(user.id)
          .then(() => undefined)
          .catch((error: { code?: string; detail?: string }) => error)
        if (failed) throw refusal(failed, 'BAD_GATEWAY')
        await organizationsService.deleteOwned(user.id)
      },
    },
  },
  disabledPaths: [
    // Admins can't act as another user (see `appRoleAccess`).
    '/admin/impersonate-user',
    '/admin/stop-impersonating',
    // Plane bans and removes users itself, each in one transaction (see
    // `api/admin`).
    '/admin/ban-user',
    '/admin/remove-user',
    // The customer portal is plane's, without switching plans (see
    // `billing.service`).
    '/subscription/billing-portal',
    // Cancelling too: the plugin's would drop an overdue subscription
    // without cancelling it with Stripe.
    '/subscription/cancel',
  ],
  plugins: [
    // Plane-wide roles and bans. The roles are plane's, an organization's are
    // the organization plugin's.
    admin({ roles: appRoleAccess, adminRoles: ['admin'] }),
    organization({
      organizationHooks: {
        // Organizations count towards their creator's plan, as its billing
        // owner.
        beforeCreateOrganization: async ({ user }) => {
          const refused = await limitsService.withRoom(
            user.id,
            'organizations',
            async () => undefined,
          )
          if (refused) throw refusal(refused)
        },
        // Checking and creating aren't one transaction: two creations racing
        // past the limit leave the newest disabled.
        afterCreateOrganization: async ({ organization, user }) => {
          await organizationsService.attachBillingOwner(
            organization.id,
            user.id,
          )
          if (env.stripe) await limitsService.reconcile(user.id)
        },
        // Deleting an organization may make room for a disabled one: its
        // billing owner, gone with it by then, is noted beforehand.
        beforeDeleteOrganization: async ({ organization }) => {
          const owner = await organizationsService.billingOwner(organization.id)
          if (owner) deletingOwners.set(organization.id, owner)
        },
        afterDeleteOrganization: async ({ organization }) => {
          const owner = deletingOwners.get(organization.id)
          deletingOwners.delete(organization.id)
          if (owner && env.stripe) await limitsService.reconcile(owner)
        },
        beforeUpdateOrganization: ({ member }) =>
          refuseIfDisabled(member.organizationId),
        beforeAddMember: ({ organization }) =>
          refuseIfDisabled(organization.id),
        beforeUpdateMemberRole: ({ organization }) =>
          refuseIfDisabled(organization.id),
        beforeCreateInvitation: ({ organization }) =>
          refuseIfDisabled(organization.id),
        beforeAcceptInvitation: ({ organization }) =>
          refuseIfDisabled(organization.id),
      },
    }),
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
    ...(stripeApi.client && env.stripe
      ? [billing(stripeApi.client, env.stripe.webhookSecret)]
      : []),
  ],
  hooks: {
    // Nobody sets their own Stripe customer. Disabled plans keep their
    // subscribers, but take no new ones; a user
    // with a payment overdue settles it before changing plans; and a new
    // checkout replaces any the user left open, so only one can be paid.
    // Invitations are refused in a disabled organization, resent ones too
    // (resending skips `beforeCreateInvitation`).
    before: createAuthMiddleware(async (ctx) => {
      // The Stripe customer is the plugin's to set: a user picking another's
      // would reach their billing.
      if (
        ctx.body &&
        typeof ctx.body === 'object' &&
        'stripeCustomerId' in ctx.body
      ) {
        throw APIError.from('BAD_REQUEST', {
          message: 'The Stripe customer cannot be set',
          code: 'STRIPE_CUSTOMER_READ_ONLY',
        })
      }
      if (ctx.path === '/organization/invite-member') {
        const session = await getSessionFromCtx(ctx)
        const organizationId =
          ctx.body?.organizationId ?? session?.session.activeOrganizationId
        if (organizationId) await refuseIfDisabled(organizationId)
        return
      }
      if (ctx.path !== '/subscription/upgrade') return
      const available = await plansService.available()
      if (!available.some(({ id }) => id === ctx.body?.plan)) {
        throw refusal(new PlanUnavailableError(), 'BAD_REQUEST')
      }
      const session = await getSessionFromCtx(ctx)
      if (!session) return
      if (await overdue(session.user.id)) {
        throw refusal(new PaymentOverdueError(), 'PAYMENT_REQUIRED')
      }
      // Subscribers change plans through plane (see `billing.service`):
      // the plugin would send them to a Stripe portal set up to allow it.
      // Stripe is asked too, for a paid checkout plane didn't hear of.
      if (
        (await billingService.liveSubscription(session.user.id)) ||
        (await billingService.subscribedInStripe(session.user.id))
      ) {
        throw refusal(new AlreadySubscribedError(), 'BAD_REQUEST')
      }
      // A change scheduled for the period's end leaves its plan unrecorded
      // until then, free to be deleted meanwhile: plans change at once.
      if (ctx.body?.scheduleAtPeriodEnd) {
        throw refusal(new ScheduledChangeError(), 'BAD_REQUEST')
      }
      await billingService.expireOpenCheckouts(session.user.id)
    }),
  },
  databaseHooks: {
    user: {
      update: {
        // Bans are lifted by an admin unbanning the user, or once expired by
        // plane (see `session.create.before`), never by the admin plugin's
        // unconditional clearing, which could undo a ban set meanwhile.
        before: async (data, ctx) => {
          if (liftsBan(data) && ctx?.path !== '/admin/unban-user') return false
        },
      },
    },
    session: {
      create: {
        // The admin plugin checks for a ban before the session is stored. A
        // sign-in racing a ban could slip a session in after banning signed
        // the user out: checking again once it's stored catches it. Banning
        // keeps the user locked until it's done, so the check waits for it.
        after: async (created) => {
          if (!(await isBanned(created.userId))) return
          await db
            .delete(schema.session)
            .where(eq(schema.session.id, created.id))
          throw APIError.from('FORBIDDEN', {
            message: 'You have been banned from this application',
            code: 'BANNED_USER',
          })
        },
        // Onboarding: sessions always start in an organization, so signing
        // up lands the user in their personal one. The admin plugin let the
        // user in, so a ban they had has expired: it's lifted, unless an
        // admin banned them again just now (`after` then turns them away).
        before: async (session) => {
          await liftExpiredBan(session.userId)
          return {
            data: {
              ...session,
              activeOrganizationId: await organizationsService.defaultFor(
                session.userId,
              ),
            },
          }
        },
      },
    },
  },
})

// How users can sign in, for the sign-in page to offer.
export const signInMethods = () => ({ github: !!env.githubSignIn })
