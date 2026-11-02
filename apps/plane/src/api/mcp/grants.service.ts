import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { auth, hashOAuthToken } from '../auth/better-auth'
import { memberRole, type Principal } from '../auth/principal'
import { NotAMemberError } from '../errors'
import { db } from '../platform/db'
import {
  mcpGrant,
  member,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  verification,
} from '../platform/db/schema'
import { env } from '../platform/env'
import {
  McpClientNotFoundError,
  McpConsentInvalidError,
  McpOrganizationRequiredError,
} from './errors'

// Which organization a user connected each MCP client to (`mcpGrant`).
// better-auth's consent covers what the client may do; the grant covers
// where.

const ownGrant = (userId: string, clientId: string) =>
  and(eq(mcpGrant.userId, userId), eq(mcpGrant.clientId, clientId))

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

// The client's tokens for the user: access tokens first, as they reference
// the refresh tokens they came from.
const dropTokens = async (
  tx: Transaction,
  userId: string,
  clientId: string,
) => {
  await tx
    .delete(oauthAccessToken)
    .where(
      and(
        eq(oauthAccessToken.userId, userId),
        eq(oauthAccessToken.clientId, clientId),
      ),
    )
  await tx
    .delete(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.userId, userId),
        eq(oauthRefreshToken.clientId, clientId),
      ),
    )
}

// The client's authorization codes for the user that it hasn't exchanged
// yet (better-auth keeps them as verification values, as JSON). Exchanged
// later, one would yield tokens for what the user agreed to back then.
const outstandingCodes = (userId: string, clientId: string) => {
  // Only JSON values are read as such: other verifications store text.
  const code = sql`(case when ${verification.value} like '{%' then ${verification.value}::jsonb end)`
  return and(
    sql`${code} ->> 'type' = 'authorization_code'`,
    sql`${code} ->> 'userId' = ${userId}`,
    sql`${code} -> 'query' ->> 'client_id' = ${clientId}`,
  )
}

// Connects the client to the organization with `scopes`, from now on:
// tokens issued before (for another organization, other scopes, or a
// disconnected client) are refused, its refresh tokens dropped, and its
// unexchanged codes too, but `code` (stored), the one this consent issued.
// Consents for the same client that overlap (say, from two tabs) settle on
// the last one bound: its organization, its scopes, its code alone.
const bind = (grant: {
  userId: string
  clientId: string
  organizationId: string
  scopes: string[]
  code: string
}) =>
  db.transaction(async (tx) => {
    const { userId, clientId, organizationId } = grant
    const now = new Date()
    await tx
      .insert(mcpGrant)
      .values({ userId, clientId, organizationId, notBefore: now })
      .onConflictDoUpdate({
        target: [mcpGrant.userId, mcpGrant.clientId],
        set: { organizationId, notBefore: now },
      })
    await tx
      .update(oauthConsent)
      .set({ scopes: grant.scopes, updatedAt: now })
      .where(
        and(
          eq(oauthConsent.userId, userId),
          eq(oauthConsent.clientId, clientId),
        ),
      )
    await dropTokens(tx, userId, clientId)
    await tx
      .delete(verification)
      .where(
        and(
          outstandingCodes(userId, clientId),
          ne(verification.identifier, grant.code),
        ),
      )
  })

const clientColumns = {
  clientId: oauthClient.clientId,
  name: oauthClient.name,
  uri: oauthClient.uri,
  icon: oauthClient.icon,
}

export const mcpGrantsService = {
  // What the consent page shows of a client: never its secrets or redirect
  // URIs.
  async client(clientId: string) {
    const [found] = await db
      .select(clientColumns)
      .from(oauthClient)
      .where(
        and(
          eq(oauthClient.clientId, clientId),
          sql`${oauthClient.disabled} is not true`,
        ),
      )
    return found ?? new McpClientNotFoundError()
  },

  // Answers the authorization request better-auth sent the user to the
  // consent page with (`oauthQuery`, as it signed it). Allowing connects the
  // client to one of the user's organizations, once better-auth has checked
  // the request and recorded the consent: the client is the one the signed
  // request names, and its earlier tokens stop working, so none acts in an
  // organization or with scopes the user didn't just agree to. Returns
  // where to send the browser next (the client, with a code or an error).
  async consent(input: {
    headers: Headers
    userId: string
    oauthQuery: string
    accept: boolean
    scope?: string
    organizationId?: string
  }) {
    const { userId, organizationId } = input
    if (input.accept) {
      if (!organizationId) return new McpOrganizationRequiredError()
      if (!(await memberRole({ userId, organizationId }))) {
        return new NotAMemberError()
      }
    }
    // Signed: better-auth refuses the request if it was altered, so the
    // client is the one it names.
    const clientId = new URLSearchParams(input.oauthQuery).get('client_id')
    if (!clientId) return new McpConsentInvalidError()
    // Through better-auth's own endpoint, as the browser would call it: it
    // checks the signature and the session, records the consent, and goes
    // on with the authorization (which needs the request).
    const response = await auth.handler(
      new Request(`${env.betterAuthUrl}/api/auth/oauth2/consent`, {
        method: 'POST',
        headers: {
          cookie: input.headers.get('cookie') ?? '',
          origin: new URL(env.betterAuthUrl).origin,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          accept: input.accept,
          scope: input.scope,
          oauth_query: input.oauthQuery,
        }),
      }),
    )
    const answer = response.ok
      ? ((await response.json()) as { url?: unknown })
      : undefined
    if (typeof answer?.url !== 'string') return new McpConsentInvalidError()
    // Back to the client with a code, or somewhere plane's own (relative,
    // e.g. signing in again) to go on.
    const code = new URL(answer.url, env.betterAuthUrl).searchParams.get('code')
    if (input.accept && organizationId && code) {
      await bind({
        userId,
        clientId,
        organizationId,
        scopes: (
          input.scope ??
          new URLSearchParams(input.oauthQuery).get('scope') ??
          ''
        )
          .split(' ')
          .filter(Boolean),
        code: hashOAuthToken(code),
      })
    }
    return { url: answer.url }
  },

  // Who the client's token acts as: the user, in the organization they
  // connected it to, as long as they're still a member there, and the token
  // was issued after they consented (`issuedAt`, in milliseconds) for no
  // more than they consented to. Without a
  // grant (never made, or revoked) or a membership, the token can't be
  // used: plane says so plainly, since granting more scopes wouldn't help.
  async principalFor(
    userId: string,
    clientId: string,
    token: { issuedAt: number | undefined; scopes: readonly string[] },
  ): Promise<Principal | NotAMemberError> {
    const [found] = await db
      .select({
        organizationId: mcpGrant.organizationId,
        notBefore: mcpGrant.notBefore,
        consented: oauthConsent.scopes,
      })
      .from(mcpGrant)
      .innerJoin(
        member,
        and(
          eq(member.userId, mcpGrant.userId),
          eq(member.organizationId, mcpGrant.organizationId),
        ),
      )
      .innerJoin(
        oauthConsent,
        and(
          eq(oauthConsent.userId, mcpGrant.userId),
          eq(oauthConsent.clientId, mcpGrant.clientId),
        ),
      )
      .where(ownGrant(userId, clientId))
      .limit(1)
    // Its scopes must still be ones the user grants: a token issued from an
    // earlier consent (a code exchanged just as the user consented again)
    // can't carry more than the current one.
    const granted = (scope: string) =>
      !scope.startsWith('plane:') || !!found?.consented.includes(scope)
    const current =
      found &&
      token.issuedAt !== undefined &&
      token.issuedAt > found.notBefore.getTime() &&
      token.scopes.every(granted)
    return current
      ? { userId, organizationId: found.organizationId }
      : new NotAMemberError()
  },

  // The clients the user has connected, latest first, with the organization
  // and scopes each was granted.
  async connected(userId: string) {
    return db
      .select({
        ...clientColumns,
        organizationId: mcpGrant.organizationId,
        organizationName: organization.name,
        scopes: oauthConsent.scopes,
        connectedAt: mcpGrant.updatedAt,
      })
      .from(mcpGrant)
      .innerJoin(oauthClient, eq(oauthClient.clientId, mcpGrant.clientId))
      .innerJoin(organization, eq(organization.id, mcpGrant.organizationId))
      .leftJoin(
        oauthConsent,
        and(
          eq(oauthConsent.userId, mcpGrant.userId),
          eq(oauthConsent.clientId, mcpGrant.clientId),
        ),
      )
      .where(eq(mcpGrant.userId, userId))
      .orderBy(desc(mcpGrant.updatedAt))
  },

  // Disconnects the client: its grant goes, so its tokens stop working at
  // once, and its consent and tokens go, so it must ask the user again.
  revoke: (userId: string, clientId: string) =>
    db.transaction(async (tx) => {
      const [grant] = await tx
        .delete(mcpGrant)
        .where(ownGrant(userId, clientId))
        .returning({ clientId: mcpGrant.clientId })
      const [consent] = await tx
        .delete(oauthConsent)
        .where(
          and(
            eq(oauthConsent.userId, userId),
            eq(oauthConsent.clientId, clientId),
          ),
        )
        .returning({ id: oauthConsent.id })
      await dropTokens(tx, userId, clientId)
      await tx.delete(verification).where(outstandingCodes(userId, clientId))
      if (!grant && !consent) return new McpClientNotFoundError()
    }),
}
