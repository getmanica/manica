import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { app } from '../src/api/app'
import { auth, mcpResource } from '../src/api/auth/better-auth'
import { env } from '../src/api/platform/env'

// Drives plane as an MCP client and its user would: OAuth through
// better-auth, then MCP, all in-process.

export const base = env.betterAuthUrl

export const request = (path: string, init?: RequestInit) =>
  app.handle(new Request(new URL(path, base), init))

// Verifying a token fetches plane's own key set from its public URL: no
// server listens in tests, so plane's requests to itself are served
// in-process.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  return new URL(request.url).origin === new URL(base).origin
    ? app.handle(request)
    : realFetch(input, init)
}) as typeof fetch

// Signs a new user up, returning the cookie their browser would send.
export const signUp = async () => {
  const email = `${crypto.randomUUID()}@example.com`
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'correct horse battery', name: 'Test' },
    returnHeaders: true,
  })
  const cookie = headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('No session cookie')
  return { cookie, userId: response.user.id }
}

const REDIRECT_URI = 'http://127.0.0.1:33418/callback'

// What the consent page sends, from the console's origin.
export const consent = (
  cookie: string,
  body: {
    oauthQuery: string
    accept: boolean
    scope?: string
    organizationId?: string
  },
  origin = base,
) =>
  request('/api/connected-apps/consent', {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// Registers a public client, as Cursor or Claude Code would.
export const registerClient = async () => {
  const response = await request('/api/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Registration failed: ${await response.text()}`)
  }
  const { client_id } = (await response.json()) as { client_id: string }
  return client_id
}

const sha256 = async (text: string) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  ).toString('base64url')

// Takes the user through authorization with the client, consenting with
// the organization picked, and returns the code the client gets.
// `accept` narrows the scopes the user grants, as unticking them on the
// consent page does.
export const authorizationCode = async ({
  cookie,
  clientId,
  organizationId,
  scope = 'openid offline_access plane:read plane:write',
  accept,
}: {
  cookie: string
  clientId: string
  organizationId: string
  scope?: string
  accept?: string
}) => {
  const verifier = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString('base64url')
  const url = new URL('/api/auth/oauth2/authorize', base)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'state',
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    resource: mcpResource,
  }).toString()
  const authorized = await app.handle(
    new Request(url, { headers: { cookie }, redirect: 'manual' }),
  )
  const location = authorized.headers.get('location')
  if (!location) {
    throw new Error(`Authorization failed: ${await authorized.text()}`)
  }
  const next = new URL(location, base)

  let callback = next
  if (next.pathname === '/consent') {
    // The consent page: the organization picked, allowing.
    const consented = await consent(cookie, {
      oauthQuery: next.search.slice(1),
      accept: true,
      scope: accept,
      organizationId,
    })
    const { url } = (await consented.json()) as { url?: string }
    if (!url) throw new Error(`Consent failed: ${consented.status}`)
    callback = new URL(url)
  }
  const code = callback.searchParams.get('code')
  if (!code) throw new Error(`No code: ${callback}`)
  return { code, verifier }
}

// The client exchanging its code for tokens.
export const exchange = (
  clientId: string,
  { code, verifier }: { code: string; verifier: string },
) =>
  request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: mcpResource,
    }),
  })

// Authorizes the client, and exchanges the code: the tokens it gets.
export const authorize = async (
  options: Parameters<typeof authorizationCode>[0],
) => {
  const token = await exchange(
    options.clientId,
    await authorizationCode(options),
  )
  const tokens = (await token.json()) as {
    access_token?: string
    refresh_token?: string
    scope?: string
  }
  if (!tokens.access_token)
    throw new Error(`No token: ${JSON.stringify(tokens)}`)
  return tokens as typeof tokens & { access_token: string }
}

// Signs a user up and connects a new client to `organizationId` (by
// default, the user's personal organization, which they own).
export const connect = async (
  options: {
    organizationId?: string
    scope?: string
    accept?: string
    user?: { cookie: string; userId: string }
  } = {},
) => {
  const user = options.user ?? (await signUp())
  const organizationId =
    options.organizationId ??
    (await auth.api.getSession({ headers: { cookie: user.cookie } }))?.session
      .activeOrganizationId
  if (!organizationId) throw new Error('No organization')
  const clientId = await registerClient()
  const tokens = await authorize({
    ...user,
    clientId,
    organizationId,
    scope: options.scope,
    accept: options.accept,
  })
  return { ...user, clientId, organizationId, tokens }
}

// An MCP client speaking to plane in-process with `token`.
export const mcpClient = async (token: string) => {
  const client = new Client(
    { name: 'test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', base), {
      fetch: (input, init) => app.handle(new Request(input, init)),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  return client
}
