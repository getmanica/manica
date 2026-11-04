import { requireMcpAuth } from '@better-auth/mcp'
import {
  type AuthInfo,
  createMcpHandler,
  readRequestBody,
} from '@modelcontextprotocol/server'
import { createInsufficientScopeError } from 'better-auth/oauth2'
import { Elysia } from 'elysia'
import {
  auth,
  mcpIssuedAtClaim,
  mcpResource,
  mcpScopes,
} from '../auth/better-auth'
import type { Principal } from '../auth/principal'
import { NotAMemberError } from '../errors'
import { mcpGrantsService } from './grants.service'
import { createMcpServer, writeTools } from './server'

// The MCP server, for clients holding an access token better-auth issued
// for `mcpResource`. A token acts as the user who consented, in the
// organization they picked then (`mcpGrant`), within the scopes they
// granted.

type Context = { principal: Principal; scopes: readonly string[] }

// The access token's claims, verified against better-auth's keys.
type Claims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1]

const handler = createMcpHandler(
  ({ authInfo }) => {
    const context = authInfo?.extra?.context as Context | undefined
    // Unreachable: every request is authenticated before it gets here.
    if (!context) throw new Error('MCP request without a principal')
    return createMcpServer(context)
  },
  // Only the 2026-07-28 protocol: stateless, one POST per request.
  { legacy: 'reject' },
)

// The token's verified claims as the MCP SDK's auth info.
const toAuthInfo = (request: Request, claims: Claims): AuthInfo => ({
  token: request.headers.get('authorization')?.replace(/^\S+\s+/, '') ?? '',
  clientId: typeof claims.azp === 'string' ? claims.azp : '',
  scopes: typeof claims.scope === 'string' ? claims.scope.split(' ') : [],
  expiresAt: claims.exp,
  resource: new URL(mcpResource),
})

// The tools a JSON-RPC message (or batch) calls.
const calledTools = (text: string) => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed]
  return messages.flatMap((message) =>
    message?.method === 'tools/call' && typeof message.params?.name === 'string'
      ? [message.params.name as string]
      : [],
  )
}

const serve = async (request: Request, claims: Claims) => {
  const authInfo = toAuthInfo(request, claims)
  // A token whose user left the organization, disconnected the client,
  // consented again since it was issued, or was banned, is refused outright:
  // no scope would help.
  const principal =
    typeof claims.sub === 'string' && authInfo.clientId
      ? await mcpGrantsService.principalFor(claims.sub, authInfo.clientId, {
          issuedAt:
            typeof claims[mcpIssuedAtClaim] === 'number'
              ? claims[mcpIssuedAtClaim]
              : undefined,
          scopes: authInfo.scopes,
        })
      : new NotAMemberError()
  if (principal instanceof Error) throw principal
  // Only then the scopes: every token must be able to read.
  if (!authInfo.scopes.includes(mcpScopes.read)) {
    throw createInsufficientScopeError([mcpScopes.read])
  }

  let forwarded = request
  if (request.method === 'POST') {
    // Read here to see which tools are called, then handed on as is.
    const body = await readRequestBody(request)
    if (body.tooLarge) return new Response(null, { status: 413 })
    // Writing takes `plane:write`: without it, the client is challenged to
    // ask the user for it, before anything runs.
    const writes = calledTools(body.text).some((name) => writeTools.has(name))
    if (writes && !authInfo.scopes.includes(mcpScopes.write)) {
      throw createInsufficientScopeError([mcpScopes.write])
    }
    forwarded = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: body.text,
      signal: request.signal,
    })
  }

  const context: Context = { principal, scopes: authInfo.scopes }
  return handler.fetch(forwarded, {
    authInfo: { ...authInfo, extra: { context } },
  })
}

const mcpEndpoint = requireMcpAuth(auth, serve, {
  resource: mcpResource,
  // Scopes are checked once the token's grant is (see `serve`). The
  // challenge asks for writing too, which the user may leave out when
  // consenting.
  challengeScopes: [mcpScopes.read, mcpScopes.write],
})

// OAuth discovery, served by better-auth: the protected resource metadata
// (at the root and under the resource's path), and the authorization
// server's metadata under its issuer's path (`/api/auth`).
const discovery = ({ request }: { request: Request }) => auth.handler(request)

export const mcpController = new Elysia()
  .all('/.well-known/oauth-protected-resource', discovery)
  .all('/.well-known/oauth-protected-resource/*', discovery)
  .all('/.well-known/oauth-authorization-server/*', discovery)
  .all('/.well-known/openid-configuration/*', discovery)
  // The body is the MCP SDK's to read.
  .all('/mcp', { parse: 'none' }, ({ request }) => mcpEndpoint(request))
