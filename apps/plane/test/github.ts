import { generateKeyPairSync } from 'node:crypto'

// An app on a fake GitHub, with a real key so forges can sign its JWTs.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

export const scope = {
  app: { externalId: '42', secrets: { privateKey } },
  installationId: '7',
  repository: 'acme/widgets',
}

export type Call = {
  method: string
  path: string
  search: string
  body: unknown
}
export type Reply = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

// A fake GitHub API: mints installation tokens, and answers everything else
// from `routes`, keyed by "METHOD /path". Replies may carry headers (e.g.
// a Link to the next page).
export const fakeGithub = (routes: Record<string, Reply>) => {
  const calls: Call[] = []
  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const text = await request.text()
    calls.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      body: text ? JSON.parse(text) : undefined,
    })
    const reply: Reply =
      url.pathname === '/app/installations/7/access_tokens'
        ? {
            status: 201,
            body: {
              token: 'ghs_test',
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
          }
        : (routes[`${request.method} ${url.pathname}${url.search}`] ??
          routes[`${request.method} ${url.pathname}`] ?? { status: 404 })
    return new Response(
      reply.body === undefined ? null : JSON.stringify(reply.body),
      {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...reply.headers },
      },
    )
  }) as typeof fetch
  return { calls, fetch: fetchFake }
}
