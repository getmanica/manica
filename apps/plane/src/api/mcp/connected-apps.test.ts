import { describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import {
  createAgent,
  createMember,
  createOrganization,
} from '../../../test/fixtures'
import {
  authorizationCode,
  authorize,
  base,
  connect,
  consent,
  exchange,
  registerClient,
  request,
  signUp,
} from '../../../test/oauth'
import { mcpResource } from '../auth/better-auth'
import { db } from '../platform/db'
import { mcpGrant, oauthConsent } from '../platform/db/schema'

const connectedApps = async (cookie: string) => {
  const response = await request('/api/connected-apps', { headers: { cookie } })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    clientId: string
    name: string
    organizationId: string
    organizationName: string
    scopes: string[]
  }[]
}

const disconnect = (cookie: string, clientId: string, origin = base) =>
  request(`/api/connected-apps?clientId=${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
    headers: { cookie, origin },
  })

const refresh = (clientId: string, refreshToken: string) =>
  request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: mcpResource,
    }),
  })

// The agents `token` lists, or the status it's refused with.
const agentNames = async (token: string) => {
  const response = await request('/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'list_agents',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'list_agents',
        arguments: {},
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
  if (response.status !== 200) return response.status
  const body = (await response.json()) as {
    result: { structuredContent: { items: { name: string }[] } }
  }
  return body.result.structuredContent.items.map((item) => item.name).sort()
}

// The consent page's signed query for a new authorization request.
const pendingConsent = async (cookie: string, clientId: string) => {
  const url = new URL('/api/auth/oauth2/authorize', base)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1:33418/callback',
    scope: 'openid offline_access plane:read plane:write',
    state: 'state',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    resource: mcpResource,
    // Asked even if the user consented before.
    prompt: 'consent',
  }).toString()
  const response = await request(url.toString(), {
    headers: { cookie },
    redirect: 'manual',
  })
  const location = new URL(response.headers.get('location') ?? '', base)
  expect(location.pathname).toBe('/consent')
  return location.search.slice(1)
}

// The organization a new user starts in (their personal one).
const connectedOrganization = async (cookie: string) => {
  const response = await request('/api/auth/organization/list', {
    headers: { cookie },
  })
  const organizations = (await response.json()) as { id: string }[]
  return organizations.map(({ id }) => id)
}

const grantOf = async (userId: string, clientId: string) => {
  const [grant] = await db
    .select()
    .from(mcpGrant)
    .where(and(eq(mcpGrant.userId, userId), eq(mcpGrant.clientId, clientId)))
  return grant
}

describe('consent', () => {
  test('the consent page sees the client, not its secrets', async () => {
    const { cookie } = await signUp()
    const clientId = await registerClient()
    const response = await request(
      `/api/connected-apps/client?clientId=${encodeURIComponent(clientId)}`,
      { headers: { cookie } },
    )
    expect(response.status).toBe(200)
    expect(Object.keys(await response.json()).sort()).toEqual([
      'clientId',
      'icon',
      'name',
      'uri',
    ])

    const unknown = await request('/api/connected-apps/client?clientId=nope', {
      headers: { cookie },
    })
    expect(unknown.status).toBe(404)
    const signedOut = await request(
      `/api/connected-apps/client?clientId=${encodeURIComponent(clientId)}`,
    )
    expect(signedOut.status).toBe(401)
  })

  test("a client can only be connected to the user's own organizations", async () => {
    const { cookie, userId } = await signUp()
    const { organizationId } = await createOrganization()
    const clientId = await registerClient()
    const oauthQuery = await pendingConsent(cookie, clientId)

    const response = await consent(cookie, {
      oauthQuery,
      accept: true,
      organizationId,
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'NOT_A_MEMBER' })
    expect(await grantOf(userId, clientId)).toBeUndefined()
  })

  test('only a request better-auth signed can change a grant', async () => {
    const user = await signUp()
    const { organizationId: other } = await createOrganization()
    await createMember(other, user.userId, 'owner')
    const { clientId, organizationId, tokens } = await connect({ user })
    await createAgent(organizationId, { name: 'personal' })

    // A made-up consent page for the same client, asking for another
    // organization: refused, and the grant and its tokens stay as they were.
    const forged = new URLSearchParams({
      client_id: clientId,
      scope: 'plane:read',
      sig: 'invalid',
    }).toString()
    const response = await consent(user.cookie, {
      oauthQuery: forged,
      accept: true,
      organizationId: other,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: 'MCP_CONSENT_INVALID',
    })
    expect((await grantOf(user.userId, clientId))?.organizationId).toBe(
      organizationId,
    )
    expect(await agentNames(tokens.access_token)).toEqual(['personal'])

    // Nor can a signed query be altered.
    const signed = new URLSearchParams(
      await pendingConsent(user.cookie, clientId),
    )
    signed.set('scope', 'openid plane:read plane:write offline_access')
    const altered = await consent(user.cookie, {
      oauthQuery: signed.toString(),
      accept: true,
      organizationId: other,
    })
    expect(altered.status).toBe(400)
    expect((await grantOf(user.userId, clientId))?.organizationId).toBe(
      organizationId,
    )
  })

  test('a consent better-auth refuses leaves the connection as it was', async () => {
    const user = await signUp()
    const { organizationId: other } = await createOrganization()
    await createMember(other, user.userId, 'owner')
    const { clientId, organizationId, tokens } = await connect({ user })
    const kept = await authorizationCode({ ...user, clientId, organizationId })

    // Signed, but accepting a scope the client never asked for.
    const refused = await consent(user.cookie, {
      oauthQuery: await pendingConsent(user.cookie, clientId),
      accept: true,
      scope: 'openid plane:read profile',
      organizationId: other,
    })
    expect(refused.status).toBe(400)
    expect((await grantOf(user.userId, clientId))?.organizationId).toBe(
      organizationId,
    )
    expect(await agentNames(tokens.access_token)).toEqual([])
    expect((await refresh(clientId, tokens.refresh_token ?? '')).status).toBe(
      200,
    )
    expect((await exchange(clientId, kept)).status).toBe(200)
  })

  test('changes must come from the console', async () => {
    const user = await signUp()
    const { clientId, organizationId } = await connect({ user })
    const oauthQuery = await pendingConsent(user.cookie, await registerClient())

    for (const origin of ['https://evil.example', 'null', '']) {
      const response = await consent(
        user.cookie,
        { oauthQuery, accept: true, organizationId },
        origin,
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: 'CROSS_ORIGIN_REQUEST',
      })
      expect((await disconnect(user.cookie, clientId, origin)).status).toBe(403)
    }
    expect(await connectedApps(user.cookie)).toHaveLength(1)
  })

  test('denying sends the client back with an error, granting nothing', async () => {
    const { cookie, userId } = await signUp()
    const clientId = await registerClient()
    const oauthQuery = await pendingConsent(cookie, clientId)
    const response = await consent(cookie, { oauthQuery, accept: false })
    expect(response.status).toBe(200)
    const { url } = (await response.json()) as { url: string }
    expect(new URL(url).searchParams.get('error')).toBe('access_denied')
    expect(await grantOf(userId, clientId)).toBeUndefined()
  })
})

describe('connected apps', () => {
  test('lists what the user connected, and where', async () => {
    const { cookie, clientId, organizationId } = await connect({
      accept: 'openid offline_access plane:read',
    })
    const other = await signUp()
    expect(await connectedApps(other.cookie)).toEqual([])

    const [app, ...rest] = await connectedApps(cookie)
    expect(rest).toEqual([])
    expect(app).toMatchObject({
      clientId,
      name: 'Test client',
      organizationId,
      organizationName: 'Personal',
    })
    expect(app?.scopes).toContain('plane:read')
    expect(app?.scopes).not.toContain('plane:write')
  })

  test('revoking stops the client at once, and for good', async () => {
    const { cookie, clientId, tokens } = await connect()
    // Refreshing works while connected.
    const refreshed = await refresh(clientId, tokens.refresh_token ?? '')
    expect(refreshed.status).toBe(200)
    const latest = (await refreshed.json()) as {
      access_token: string
      refresh_token: string
    }
    expect(await agentNames(latest.access_token)).toEqual([])

    // Another user can't revoke it.
    const other = await signUp()
    expect((await disconnect(other.cookie, clientId)).status).toBe(404)

    expect((await disconnect(cookie, clientId)).status).toBe(204)
    expect(await connectedApps(cookie)).toEqual([])
    const [consented] = await db
      .select()
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId))
    expect(consented).toBeUndefined()

    // Its unexpired access tokens have no grant…
    expect(await agentNames(tokens.access_token)).toBe(403)
    expect(await agentNames(latest.access_token)).toBe(403)
    // …and its refresh tokens are gone: refused as an OAuth error.
    const after = await refresh(clientId, latest.refresh_token)
    expect([400, 401]).toContain(after.status)
    expect(await after.json()).toMatchObject({ error: 'invalid_grant' })
  })

  test('reconnecting does not bring back tokens issued before', async () => {
    const user = await signUp()
    const { clientId, organizationId, tokens } = await connect({ user })
    expect((await disconnect(user.cookie, clientId)).status).toBe(204)

    // Connected again, read-only this time: the old write token stays dead,
    // although issued within the same second.
    const again = await authorize({
      ...user,
      clientId,
      organizationId,
      accept: 'openid plane:read',
    })
    expect(await agentNames(again.access_token)).toEqual([])
    expect(await agentNames(tokens.access_token)).toBe(403)
  })

  test("codes the client didn't exchange die with its consent", async () => {
    const user = await signUp()
    const { organizationId: other } = await createOrganization()
    await createMember(other, user.userId, 'owner')
    const { clientId, organizationId } = await connect({ user })

    // A write code, kept back, then the client disconnected.
    const kept = await authorizationCode({ ...user, clientId, organizationId })
    expect((await disconnect(user.cookie, clientId)).status).toBe(204)
    expect((await exchange(clientId, kept)).status).toBeGreaterThanOrEqual(400)

    // A write code kept back across consenting again, read-only and in
    // another organization (the consent page asked again).
    const again = await authorizationCode({ ...user, clientId, organizationId })
    const oauthQuery = await pendingConsent(user.cookie, clientId)
    const consented = await consent(user.cookie, {
      oauthQuery,
      accept: true,
      scope: 'openid plane:read',
      organizationId: other,
    })
    const { url } = (await consented.json()) as { url: string }
    expect((await exchange(clientId, again)).status).toBeGreaterThanOrEqual(400)
    // The code from the consent just given still works.
    const fresh = await exchange(clientId, {
      code: new URL(url).searchParams.get('code') ?? '',
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    })
    const { access_token, scope } = (await fresh.json()) as {
      access_token: string
      scope: string
    }
    expect(scope).not.toContain('plane:write')
    expect(await agentNames(access_token)).toEqual([])
  })

  test('consenting again replaces the connection, old tokens and all', async () => {
    const user = await signUp()
    const { organizationId: other } = await createOrganization()
    await createMember(other, user.userId, 'owner')
    await createAgent(other, { name: 'other' })
    const { clientId, organizationId, tokens } = await connect({ user })

    // Asked again while connected: denying leaves the connection be.
    const denied = await consent(user.cookie, {
      oauthQuery: await pendingConsent(user.cookie, clientId),
      accept: false,
    })
    expect(denied.status).toBe(200)
    expect((await grantOf(user.userId, clientId))?.organizationId).toBe(
      organizationId,
    )
    expect(await agentNames(tokens.access_token)).toEqual([])

    // Allowing, read-only in the other organization, replaces it.
    const consented = await consent(user.cookie, {
      oauthQuery: await pendingConsent(user.cookie, clientId),
      accept: true,
      scope: 'openid offline_access plane:read',
      organizationId: other,
    })
    const { url } = (await consented.json()) as { url: string }
    const fresh = (await (
      await exchange(clientId, {
        code: new URL(url).searchParams.get('code') ?? '',
        verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      })
    ).json()) as { access_token: string; refresh_token: string; scope: string }
    expect(fresh.scope).not.toContain('plane:write')
    expect(await agentNames(fresh.access_token)).toEqual(['other'])
    const [app] = await connectedApps(user.cookie)
    expect(app?.organizationId).toBe(other)
    expect(app?.scopes).not.toContain('plane:write')

    // The earlier tokens: refused, and no longer refreshable.
    expect(await agentNames(tokens.access_token)).toBe(403)
    const stale = await refresh(clientId, tokens.refresh_token ?? '')
    expect(await stale.json()).toMatchObject({ error: 'invalid_grant' })
    // The new refresh token keeps working, read-only.
    const renewed = await refresh(clientId, fresh.refresh_token)
    expect(renewed.status).toBe(200)
    const { scope } = (await renewed.json()) as { scope: string }
    expect(scope).not.toContain('plane:write')
  })

  test('a token carries no more than the consent the user gives now', async () => {
    // As if the client exchanged an earlier write code just as the user
    // consented again, read-only: the token is new, its scopes are not.
    const user = await signUp()
    const { clientId, tokens } = await connect({ user })
    const readOnly = await connect({
      user,
      accept: 'openid offline_access plane:read',
    })
    await db
      .update(oauthConsent)
      .set({ scopes: ['openid', 'offline_access', 'plane:read'] })
      .where(
        and(
          eq(oauthConsent.userId, user.userId),
          eq(oauthConsent.clientId, clientId),
        ),
      )
    expect(await agentNames(tokens.access_token)).toBe(403)
    expect(await agentNames(readOnly.tokens.access_token)).toEqual([])
  })

  test('two consents at once leave one connection, and at most one code', async () => {
    const user = await signUp()
    const { organizationId: other } = await createOrganization()
    await createMember(other, user.userId, 'owner')
    await createAgent(other, { name: 'other' })
    const { clientId, organizationId } = await connect({ user })
    const [first, second] = await Promise.all([
      pendingConsent(user.cookie, clientId),
      pendingConsent(user.cookie, clientId),
    ])

    // Write in one organization, and read-only in the other, at once.
    const answers = await Promise.all([
      consent(user.cookie, {
        oauthQuery: first,
        accept: true,
        organizationId,
      }),
      consent(user.cookie, {
        oauthQuery: second,
        accept: true,
        scope: 'openid offline_access plane:read',
        organizationId: other,
      }),
    ])
    const exchanged = []
    for (const answer of answers) {
      expect(answer.status).toBe(200)
      const { url } = (await answer.json()) as { url: string }
      const code = new URL(url, base).searchParams.get('code')
      if (!code) continue
      const response = await exchange(clientId, {
        code,
        verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      })
      if (response.ok) {
        exchanged.push(
          (await response.json()) as { access_token: string; scope: string },
        )
      }
    }
    // They settle on the last one bound: its organization and scopes, and
    // at most its code (the other may have dropped it too: try again).
    expect(exchanged.length).toBeLessThanOrEqual(1)
    const grant = await grantOf(user.userId, clientId)
    const [app] = await connectedApps(user.cookie)
    const writes = grant?.organizationId === organizationId
    expect(app?.scopes.includes('plane:write')).toBe(writes)
    for (const token of exchanged) {
      expect(token.scope.includes('plane:write')).toBe(writes)
      expect(await agentNames(token.access_token)).toEqual(
        writes ? [] : ['other'],
      )
    }
  })

  test('many consents at once all go through', async () => {
    // More than the database pool holds: no consent may wait on another
    // while holding a connection.
    const clientId = await registerClient()
    const users = await Promise.all(
      Array.from({ length: 15 }, async () => {
        const user = await signUp()
        const [membership] = await connectedOrganization(user.cookie)
        return { ...user, organizationId: membership }
      }),
    )
    const pending = await Promise.all(
      users.map((user) => pendingConsent(user.cookie, clientId)),
    )
    const answers = await Promise.all(
      users.map((user, i) =>
        consent(user.cookie, {
          oauthQuery: pending[i] ?? '',
          accept: true,
          organizationId: user.organizationId,
        }),
      ),
    )
    expect(answers.map((answer) => answer.status)).toEqual(users.map(() => 200))
  }, 20_000)

  test('switching organization leaves earlier tokens behind', async () => {
    const user = await signUp()
    const { organizationId: other } = await createOrganization()
    await createMember(other, user.userId, 'owner')
    await createAgent(other, { name: 'other' })
    const { clientId, tokens } = await connect({ user })
    expect(await agentNames(tokens.access_token)).toEqual([])

    expect((await disconnect(user.cookie, clientId)).status).toBe(204)
    const switched = await authorize({
      ...user,
      clientId,
      organizationId: other,
    })
    expect(await agentNames(switched.access_token)).toEqual(['other'])
    // The earlier token neither follows the grant nor keeps the old one.
    expect(await agentNames(tokens.access_token)).toBe(403)
  })
})
