import { describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import {
  createAgent,
  createJob,
  createMember,
  createOrganization,
} from '../../../test/fixtures'
import {
  authorize,
  base,
  connect,
  mcpClient,
  registerClient,
  request,
  signUp,
} from '../../../test/oauth'
import { agentsService } from '../agents/agents.service'
import { auth, mcpResource } from '../auth/better-auth'
import { db } from '../platform/db'
import { agent, mcpGrant, member, runner } from '../platform/db/schema'

const PROTOCOL = '2026-07-28'

// One raw JSON-RPC call to the MCP endpoint, as a 2026-07-28 client sends
// it, for checking statuses and headers the SDK client hides.
const rpc = (
  token: string | undefined,
  method: string,
  params: Record<string, unknown> = {},
) =>
  request('/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': PROTOCOL,
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL,
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })

const callTool = (token: string, name: string, args = {}) =>
  rpc(token, 'tools/call', { name, arguments: args })

type ToolResult = {
  isError?: boolean
  structuredContent?: Record<string, unknown> & {
    items?: { id: string; name: string }[]
    total?: number
    nextCursor?: string
    code?: string
  }
}

const result = async (response: Response) => {
  expect(response.status).toBe(200)
  const body = (await response.json()) as { result?: ToolResult }
  if (!body.result) throw new Error(`No result: ${JSON.stringify(body)}`)
  return body.result
}

const agentNames = async (token: string) => {
  const { structuredContent } = await result(
    await callTool(token, 'list_agents', { size: 100 }),
  )
  return structuredContent?.items?.map((item) => item.name).sort()
}

describe('discovery', () => {
  test('the protected resource names its authorization server', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const response = await request(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        resource: mcpResource,
        authorization_servers: [`${base}/api/auth`],
        scopes_supported: ['plane:read', 'plane:write'],
        bearer_methods_supported: ['header'],
      })
    }
  })

  test('the authorization server is found under its issuer path', async () => {
    const response = await request(
      '/.well-known/oauth-authorization-server/api/auth',
    )
    expect(response.status).toBe(200)
    const metadata = (await response.json()) as Record<string, unknown>
    expect(metadata).toMatchObject({
      issuer: `${base}/api/auth`,
      authorization_endpoint: `${base}/api/auth/oauth2/authorize`,
      token_endpoint: `${base}/api/auth/oauth2/token`,
      registration_endpoint: `${base}/api/auth/oauth2/register`,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ['S256'],
    })
    expect(metadata.scopes_supported).toEqual(
      expect.arrayContaining(['plane:read', 'plane:write', 'offline_access']),
    )
    expect(metadata.grant_types_supported).not.toContain('client_credentials')

    const openid = await request('/api/auth/.well-known/openid-configuration')
    expect(openid.status).toBe(200)
    expect(await openid.json()).toMatchObject({ issuer: `${base}/api/auth` })
  })

  test('the key set tokens are signed with is public', async () => {
    const response = await request('/api/auth/jwks')
    expect(response.status).toBe(200)
    const { keys } = (await response.json()) as { keys: { d?: string }[] }
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => key.d === undefined)).toBe(true)
  })
})

describe('authentication', () => {
  test('without a token, the client is challenged to authorize', async () => {
    const response = await rpc(undefined, 'tools/list')
    expect(response.status).toBe(401)
    const challenge = response.headers.get('www-authenticate') ?? ''
    expect(challenge).toStartWith('Bearer ')
    expect(challenge).toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    )
    expect(challenge).toContain('scope="plane:read plane:write"')
  })

  test('forged, foreign and identity tokens are refused', async () => {
    const { tokens } = await connect()
    const [header, payload] = tokens.access_token.split('.')
    const claims = JSON.parse(
      Buffer.from(payload ?? '', 'base64url').toString(),
    )
    const forged = [
      header,
      Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString(
        'base64url',
      ),
      tokens.access_token.split('.')[2],
    ].join('.')
    const { id_token: idToken } = tokens as { id_token?: string }
    expect(idToken).toBeString()
    // Signed by plane, with the claims of a valid token, but expired.
    const { token: expired } = await auth.api.signJWT({
      body: {
        payload: {
          ...claims,
          iat: Math.floor(Date.now() / 1000) - 600,
          exp: Math.floor(Date.now() / 1000) - 300,
        },
      },
    })

    for (const token of [
      'not-a-token',
      forged,
      expired,
      // Signed by plane, but for the client, not this resource.
      idToken ?? '',
    ]) {
      const response = await rpc(token, 'tools/list')
      expect(response.status).toBe(401)
      expect(response.headers.get('www-authenticate')).toContain('Bearer')
    }
  })

  test('a token must be able to read', async () => {
    const { tokens } = await connect({ accept: 'openid' })
    const response = await rpc(tokens.access_token, 'tools/list')
    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toContain(
      'error="insufficient_scope"',
    )
  })

  test('only the 2026-07-28 protocol is served', async () => {
    const { tokens } = await connect()
    const legacy = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'old', version: '1' },
        },
      }),
    })
    expect(legacy.status).toBe(400)
    expect(await legacy.text()).toContain(PROTOCOL)
  })
})

describe('requests', () => {
  test('tokens other than access tokens for this resource are refused', async () => {
    const { cookie } = await connect()
    // The session's own JWT (jwt plugin): for plane, not for /mcp.
    const session = (await (
      await request('/api/auth/token', { headers: { cookie } })
    ).json()) as { token: string }
    expect((await rpc(session.token, 'tools/list')).status).toBe(401)
    // Signing arbitrary JWTs isn't exposed.
    const sign = await request('/api/auth/sign-jwt', {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { aud: mcpResource } }),
    })
    expect(sign.status).toBe(404)
  })

  test('a token must name its user and client', async () => {
    const { tokens } = await connect()
    // The claims of a token plane issued, signed again as they are or with
    // one left out.
    const claims = JSON.parse(
      Buffer.from(
        tokens.access_token.split('.')[1] ?? '',
        'base64url',
      ).toString(),
    ) as Record<string, unknown>
    const signed = async (omit?: string) => {
      const payload = { ...claims }
      if (omit) delete payload[omit]
      return (await auth.api.signJWT({ body: { payload } })).token
    }
    expect((await rpc(await signed(), 'tools/list')).status).toBe(200)

    // No user: acts as no one, plainly.
    const anonymous = await rpc(await signed('sub'), 'tools/list')
    expect(anonymous.status).toBe(403)
    expect(anonymous.headers.get('www-authenticate')).toBeNull()
    expect(await anonymous.json()).toMatchObject({ code: 'NOT_A_MEMBER' })
    // No issue time to check against the consent: likewise.
    const undated = await rpc(await signed('plane_iat_ms'), 'tools/list')
    expect(undated.status).toBe(403)
    expect(undated.headers.get('www-authenticate')).toBeNull()
    // No client: not a valid access token at all.
    expect((await rpc(await signed('azp'), 'tools/list')).status).toBe(401)
  })

  test('malformed bodies are refused, not crashed on', async () => {
    const { tokens } = await connect()
    for (const body of ['{not json', '[]', '"text"', '{}']) {
      const response = await request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL,
        },
        body,
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    }
  })

  test('a write hidden in a batch still needs plane:write', async () => {
    const { tokens, organizationId } = await connect({
      accept: 'openid plane:read',
    })
    const meta = {
      'io.modelcontextprotocol/protocolVersion': PROTOCOL,
      'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
      'io.modelcontextprotocol/clientCapabilities': {},
    }
    const response = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL,
      },
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_agents', arguments: {}, _meta: meta },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'create_agent',
            arguments: { name: 'sneaky', os: 'linux', arch: 'x86_64' },
            _meta: meta,
          },
        },
      ]),
    })
    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toContain(
      'insufficient_scope',
    )
    const agents = await db
      .select()
      .from(agent)
      .where(eq(agent.organizationId, organizationId))
    expect(agents).toEqual([])
  })

  test('oversized bodies are refused before parsing', async () => {
    const { tokens } = await connect()
    const response = await request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: `{"padding":"${'x'.repeat(5 * 1024 * 1024)}"}`,
    })
    expect(response.status).toBe(413)
  })

  test('only POST is served', async () => {
    const { tokens } = await connect()
    for (const method of ['GET', 'DELETE']) {
      const response = await request('/mcp', {
        method,
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL,
        },
      })
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.status).toBeLessThan(500)
    }
  })
})

describe('tools', () => {
  test('lists every tool, write tools marked as such', async () => {
    const { tokens } = await connect({ accept: 'openid plane:read' })
    const client = await mcpClient(tokens.access_token)
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
    expect(Object.keys(byName).sort()).toEqual([
      'create_agent',
      'delete_agent',
      'get_forge_app',
      'get_overview',
      'list_agents',
      'list_forge_apps',
      'list_jobs',
      'update_agent',
    ])
    expect(byName.delete_agent?.annotations?.destructiveHint).toBe(true)
    for (const name of ['create_agent', 'update_agent', 'delete_agent']) {
      expect(byName[name]?.annotations?.readOnlyHint).toBe(false)
    }
    for (const name of [
      'get_overview',
      'list_jobs',
      'list_agents',
      'list_forge_apps',
      'get_forge_app',
    ]) {
      expect(byName[name]?.annotations?.readOnlyHint).toBe(true)
    }
    expect(Object.keys(byName)).not.toContain('regenerate_agent_token')
  })

  test('reads the organization through the services', async () => {
    const { tokens, organizationId } = await connect()
    const client = await mcpClient(tokens.access_token)
    await createAgent(organizationId, { name: 'builder' })

    const overview = await client.callTool({
      name: 'get_overview',
      arguments: { range: '7d' },
    })
    expect(overview.isError).toBeFalsy()
    expect(overview.structuredContent).toMatchObject({ range: '7d' })

    const apps = await client.callTool({
      name: 'list_forge_apps',
      arguments: {},
    })
    expect(apps.structuredContent).toMatchObject({ items: [], total: 0 })

    expect(await agentNames(tokens.access_token)).toEqual(['builder'])
  })

  test('lists jobs by range and outcome, in the organization only', async () => {
    const user = await signUp()
    const { organizationId, app } = await createOrganization()
    await createMember(organizationId, user.userId, 'owner')
    const foreign = await createOrganization()
    const hour = 60 * 60 * 1000
    const ago = (ms: number) => new Date(Date.now() - ms)
    const failed = (name: string, queuedAt: Date) =>
      createJob(organizationId, app.id, {
        name,
        status: 'completed',
        conclusion: 'failure',
        queuedAt,
      })
    for (let i = 0; i < 11; i++) await failed(`failed-${i}`, ago(i * 1000))
    await failed('failed-yesterday', ago(30 * hour))
    await createJob(organizationId, app.id, {
      name: 'passed',
      status: 'completed',
      conclusion: 'success',
    })
    await createJob(foreign.organizationId, foreign.app.id, {
      name: 'foreign',
      status: 'completed',
      conclusion: 'failure',
    })
    const { tokens } = await connect({ user, organizationId })

    const first = await result(
      await callTool(tokens.access_token, 'list_jobs', {
        range: '24h',
        status: ['failure'],
      }),
    )
    expect(first.structuredContent?.total).toBe(11)
    expect(first.structuredContent?.items).toHaveLength(10)
    const second = await result(
      await callTool(tokens.access_token, 'list_jobs', {
        cursor: first.structuredContent?.nextCursor,
      }),
    )
    expect(second.structuredContent?.items?.map((item) => item.name)).toEqual([
      'failed-10',
    ])
    expect(second.structuredContent?.nextCursor).toBeUndefined()

    const all = await result(
      await callTool(tokens.access_token, 'list_jobs', { size: 100 }),
    )
    expect(all.structuredContent?.total).toBe(13)
    expect(
      all.structuredContent?.items?.map((item) => item.name),
    ).not.toContain('foreign')
  })

  test('invalid arguments are refused before reaching a service', async () => {
    const { tokens } = await connect()
    const response = await callTool(tokens.access_token, 'list_jobs', {
      range: 'forever',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      result?: ToolResult
      error?: { message: string }
    }
    const message = body.error?.message ?? JSON.stringify(body.result)
    expect(message).toContain('range')
  })

  test('pages on with cursors', async () => {
    const { tokens, organizationId } = await connect()
    for (let i = 0; i < 12; i++) {
      await createAgent(organizationId, { name: `agent-${i}` })
    }
    const first = await result(
      await callTool(tokens.access_token, 'list_agents', {
        sort: 'name',
        dir: 'asc',
      }),
    )
    expect(first.structuredContent?.items).toHaveLength(10)
    expect(first.structuredContent?.total).toBe(12)
    const cursor = first.structuredContent?.nextCursor
    expect(cursor).toBeString()

    // The cursor carries the query: other arguments don't change it.
    const second = await result(
      await callTool(tokens.access_token, 'list_agents', {
        cursor,
        sort: 'createdAt',
      }),
    )
    expect(second.structuredContent?.items?.map((item) => item.name)).toEqual([
      'agent-8',
      'agent-9',
    ])
    expect(second.structuredContent?.nextCursor).toBeUndefined()
  })

  test('a malformed cursor is a tool error', async () => {
    const { tokens } = await connect()
    const forged = Buffer.from(JSON.stringify({ size: 1000 })).toString(
      'base64url',
    )
    for (const cursor of ['%%%', forged]) {
      const { isError, structuredContent } = await result(
        await callTool(tokens.access_token, 'list_agents', { cursor }),
      )
      expect(isError).toBe(true)
      expect(structuredContent?.code).toBe('INVALID_CURSOR')
    }
  })

  test('creates, updates and deletes agents', async () => {
    const { tokens } = await connect()
    const created = await result(
      await callTool(tokens.access_token, 'create_agent', {
        name: '  mac-mini ',
        os: 'darwin',
        arch: 'arm64',
        labels: ['gpu'],
      }),
    )
    expect(created.isError).toBeFalsy()
    const { agent: made, token } = created.structuredContent as {
      agent: { id: string; name: string }
      token: string
    }
    expect(made.name).toBe('mac-mini')
    expect(token).toStartWith('mna_')

    const taken = await result(
      await callTool(tokens.access_token, 'create_agent', {
        name: 'mac-mini',
        os: 'linux',
        arch: 'x86_64',
      }),
    )
    expect(taken.isError).toBe(true)
    expect(taken.structuredContent?.code).toBe('AGENT_NAME_TAKEN')

    const updated = await result(
      await callTool(tokens.access_token, 'update_agent', {
        id: made.id,
        slots: 4,
      }),
    )
    expect(updated.structuredContent).toMatchObject({ id: made.id, slots: 4 })

    const noop = await result(
      await callTool(tokens.access_token, 'update_agent', { id: made.id }),
    )
    expect(noop.structuredContent?.code).toBe('NO_CHANGES')

    const deleted = await result(
      await callTool(tokens.access_token, 'delete_agent', { id: made.id }),
    )
    expect(deleted.isError).toBeFalsy()
    expect(await agentNames(tokens.access_token)).toEqual([])

    const gone = await result(
      await callTool(tokens.access_token, 'delete_agent', { id: made.id }),
    )
    expect(gone.structuredContent?.code).toBe('AGENT_NOT_FOUND')
  })
})

describe('deleting agents', () => {
  test('refused while the agent runs jobs, which keep their runner', async () => {
    const user = await signUp()
    const { organizationId, app } = await createOrganization()
    await createMember(organizationId, user.userId, 'owner')
    const busy = await createAgent(organizationId, { name: 'busy' })
    const [live] = await db
      .insert(runner)
      .values({
        id: crypto.randomUUID(),
        agentId: busy.id,
        forgeAppId: app.id,
        installationId: '7',
        repository: 'acme/widgets',
        labels: ['self-hosted'],
        state: 'running',
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning()
    const { tokens } = await connect({ user, organizationId })

    const refused = await result(
      await callTool(tokens.access_token, 'delete_agent', { id: busy.id }),
    )
    expect(refused.structuredContent?.code).toBe('AGENT_BUSY')
    const [kept] = await db.select().from(agent).where(eq(agent.id, busy.id))
    expect(kept).toEqual(busy)
    const [still] = await db
      .select()
      .from(runner)
      .where(eq(runner.id, live?.id ?? ''))
    expect(still).toEqual(live)
  })

  test("a deleted agent's token stops working", async () => {
    const { tokens } = await connect()
    const created = await result(
      await callTool(tokens.access_token, 'create_agent', {
        name: 'short-lived',
        os: 'linux',
        arch: 'x86_64',
      }),
    )
    const { agent: made, token } = created.structuredContent as {
      agent: { id: string }
      token: string
    }
    expect((await agentsService.authenticate(token))?.id).toBe(made.id)
    await callTool(tokens.access_token, 'delete_agent', { id: made.id })
    expect(await agentsService.authenticate(token)).toBeUndefined()
  })
})

describe('organization isolation', () => {
  test('the overview counts the organization only', async () => {
    const user = await signUp()
    const { organizationId, app } = await createOrganization()
    await createMember(organizationId, user.userId, 'owner')
    const foreign = await createOrganization()
    await createAgent(organizationId, { name: 'ours' })
    await createAgent(foreign.organizationId, { name: 'theirs' })
    for (let i = 0; i < 3; i++) await createJob(organizationId, app.id)
    await createJob(foreign.organizationId, foreign.app.id)
    const { tokens } = await connect({ user, organizationId })

    const { structuredContent } = await result(
      await callTool(tokens.access_token, 'get_overview', { range: '24h' }),
    )
    const overview = structuredContent as unknown as {
      current: { jobs: number }
      agents: { name: string }[]
    }
    expect(overview.current.jobs).toBe(3)
    expect(overview.agents.map((agent) => agent.name)).toEqual(['ours'])
  })

  test("a token for one organization can't see or touch another's", async () => {
    const user = await signUp()
    const { organizationId: a, app: appA } = await createOrganization()
    const { organizationId: b, app: appB } = await createOrganization()
    await createMember(a, user.userId, 'owner')
    await createMember(b, user.userId, 'owner')
    await createAgent(a, { name: 'in-a' })
    const inB = await createAgent(b, { name: 'in-b' })

    const { tokens } = await connect({ user, organizationId: a })
    const token = tokens.access_token

    expect(await agentNames(token)).toEqual(['in-a'])

    const apps = await result(await callTool(token, 'list_forge_apps'))
    expect(apps.structuredContent?.items?.map((item) => item.id)).toEqual([
      appA.id,
    ])
    const own = await result(
      await callTool(token, 'get_forge_app', { id: appA.id }),
    )
    expect(own.structuredContent).toMatchObject({ id: appA.id })
    const foreign = await result(
      await callTool(token, 'get_forge_app', { id: appB.id }),
    )
    expect(foreign.structuredContent?.code).toBe('FORGE_APP_NOT_FOUND')

    for (const [name, args] of [
      ['update_agent', { id: inB.id, name: 'stolen' }],
      ['delete_agent', { id: inB.id }],
    ] as const) {
      const { structuredContent } = await result(
        await callTool(token, name, args),
      )
      expect(structuredContent?.code).toBe('AGENT_NOT_FOUND')
    }
    const [untouched] = await db
      .select()
      .from(agent)
      .where(eq(agent.id, inB.id))
    expect(untouched?.name).toBe('in-b')
  })

  test('a client is connected to one organization per user', async () => {
    const user = await signUp()
    const { organizationId: a } = await createOrganization()
    const { organizationId: b } = await createOrganization()
    await createMember(a, user.userId, 'owner')
    await createMember(b, user.userId, 'owner')
    await createAgent(a, { name: 'in-a' })
    await createAgent(b, { name: 'in-b' })

    const clientId = await registerClient()
    const first = await authorize({ ...user, clientId, organizationId: a })
    expect(await agentNames(first.access_token)).toEqual(['in-a'])

    // Reconnected to the other organization: the new token acts there, the
    // old one nowhere (see `connected-apps.test.ts`).
    await request(
      `/api/connected-apps?clientId=${encodeURIComponent(clientId)}`,
      { method: 'DELETE', headers: { cookie: user.cookie, origin: base } },
    )
    const second = await authorize({ ...user, clientId, organizationId: b })
    expect(await agentNames(second.access_token)).toEqual(['in-b'])
  })
})

describe('authorization', () => {
  test('writing without plane:write challenges the client to step up', async () => {
    const { tokens, organizationId } = await connect({
      accept: 'openid offline_access plane:read',
    })
    expect(tokens.scope).not.toContain('plane:write')
    const existing = await createAgent(organizationId, { name: 'kept' })

    for (const [name, args] of [
      ['create_agent', { name: 'x', os: 'linux', arch: 'x86_64' }],
      ['update_agent', { id: existing.id, slots: 2 }],
      ['delete_agent', { id: existing.id }],
    ] as const) {
      const response = await callTool(tokens.access_token, name, args)
      expect(response.status).toBe(403)
      const challenge = response.headers.get('www-authenticate') ?? ''
      expect(challenge).toContain('error="insufficient_scope"')
      expect(challenge).toContain('scope="plane:write"')
    }
    expect(await agentNames(tokens.access_token)).toEqual(['kept'])
    const [stored] = await db
      .select()
      .from(agent)
      .where(eq(agent.id, existing.id))
    expect(stored).toEqual(existing)
  })

  test("a role that can't manage the organization can read, not write", async () => {
    const user = await signUp()
    const { organizationId } = await createOrganization()
    await createMember(organizationId, user.userId, 'member')
    const existing = await createAgent(organizationId, { name: 'kept' })
    const { tokens } = await connect({ user, organizationId })

    expect(await agentNames(tokens.access_token)).toEqual(['kept'])
    for (const [name, args] of [
      ['create_agent', { name: 'x', os: 'linux', arch: 'x86_64' }],
      ['update_agent', { id: existing.id, slots: 2 }],
      ['delete_agent', { id: existing.id }],
    ] as const) {
      const { isError, structuredContent } = await result(
        await callTool(tokens.access_token, name, args),
      )
      expect(isError).toBe(true)
      expect(structuredContent?.code).toBe('FORBIDDEN')
    }
    expect(await agentNames(tokens.access_token)).toEqual(['kept'])
    const [stored] = await db
      .select()
      .from(agent)
      .where(eq(agent.id, existing.id))
    expect(stored).toEqual(existing)
  })

  test('a removed member is refused outright, never challenged', async () => {
    const user = await signUp()
    const { organizationId } = await createOrganization()
    await createMember(organizationId, user.userId, 'owner')
    const { tokens } = await connect({ user, organizationId })
    const readOnly = await connect({
      user,
      organizationId,
      accept: 'openid plane:read',
    })
    const unreadable = await connect({ user, organizationId, accept: 'openid' })
    await db
      .delete(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, user.userId),
        ),
      )

    for (const response of [
      await rpc(unreadable.tokens.access_token, 'tools/list'),
      await rpc(tokens.access_token, 'tools/list'),
      await callTool(tokens.access_token, 'list_agents'),
      await callTool(readOnly.tokens.access_token, 'create_agent', {
        name: 'x',
        os: 'linux',
        arch: 'x86_64',
      }),
    ]) {
      expect(response.status).toBe(403)
      expect(response.headers.get('www-authenticate')).toBeNull()
      expect(await response.json()).toMatchObject({ code: 'NOT_A_MEMBER' })
    }
  })

  test('without a grant, a valid token is refused', async () => {
    const { tokens, userId, clientId } = await connect()
    await db
      .delete(mcpGrant)
      .where(and(eq(mcpGrant.userId, userId), eq(mcpGrant.clientId, clientId)))
    const response = await rpc(tokens.access_token, 'tools/list')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'NOT_A_MEMBER' })
  })
})
