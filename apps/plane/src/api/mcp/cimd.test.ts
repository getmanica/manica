import { describe, expect, test, vi } from 'vitest'
import { base, request, signUp } from '../../../test/oauth'
import { mcpResource } from '../auth/better-auth'

// DNS as plane's resolver sees it: every host answers a private address.
// Only `platform/pinned-fetch` resolves names itself (the MCP transport
// wouldn't otherwise look them up), so a lookup here shows CIMD goes
// through it.
const lookups = vi.hoisted((): string[] => [])
vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    lookups.push(hostname)
    return [{ address: '10.0.0.7', family: 4 }]
  },
}))

describe('client metadata documents', () => {
  test('are fetched through the pinned transport, which refuses private hosts', async () => {
    const { cookie } = await signUp()
    const clientId = 'https://cimd.example.com/oauth/client.json'
    const url = new URL('/api/auth/oauth2/authorize', base)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:33418/callback',
      scope: 'openid plane:read',
      state: 'state',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      resource: mcpResource,
    }).toString()
    const response = await request(url.toString(), {
      headers: { cookie },
      redirect: 'manual',
    })

    expect(lookups).toContain('cimd.example.com')
    // Refused outright: no redirect to the client, nor on to consent.
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.json()).toMatchObject({ error: 'invalid_client' })
  })
})
