import { describe, expect, test } from 'bun:test'
import {
  createPinnedFetch,
  isSpecialUseAddress,
  PinnedFetchError,
} from './pinned-fetch'

type Sent = { url: URL; init: BunFetchRequestInit }

// A transport whose DNS answers `addresses` for every host, recording what
// it would send instead of sending it.
const transport = (
  addresses: string[] | Error,
  reply: () => Response = () => Response.json({ ok: true }),
) => {
  const sent: Sent[] = []
  const lookups: string[] = []
  const pinned = createPinnedFetch({
    resolve: async (hostname) => {
      lookups.push(hostname)
      if (addresses instanceof Error) throw addresses
      return addresses.map((address) => ({ address }))
    },
    fetch: (async (url: URL, init: BunFetchRequestInit) => {
      sent.push({ url, init })
      return reply()
    }) as unknown as typeof fetch,
  })
  return { pinned, sent, lookups }
}

const refused = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(PinnedFetchError)
}

describe('isSpecialUseAddress', () => {
  test.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '100::1',
    '2001::1',
    '2001:db8::1',
    '2002:a00:1::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%en0',
    'ff02::1',
    'not-an-ip',
    '',
  ])('refuses %s', (address) => {
    expect(isSpecialUseAddress(address)).toBe(true)
  })

  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '104.20.23.154',
    '172.32.0.1',
    '192.169.0.1',
    '2606:4700:10::ac42:93f3',
    '2a00:1450:4007:80e::200e',
  ])('allows %s', (address) => {
    expect(isSpecialUseAddress(address)).toBe(false)
  })
})

describe('pinned fetch', () => {
  test('connects to the address it checked, as the hostname', async () => {
    const { pinned, sent, lookups } = transport(['93.184.215.14', '1.1.1.1'])
    const response = await pinned('https://client.example.com/oauth.json', {
      headers: { accept: 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(lookups).toEqual(['client.example.com'])
    expect(sent).toHaveLength(1)
    const [{ url, init }] = sent as [Sent]
    expect(url.href).toBe('https://93.184.215.14/oauth.json')
    const headers = new Headers(init.headers)
    expect(headers.get('host')).toBe('client.example.com')
    expect(headers.get('accept')).toBe('application/json')
    expect(init.tls?.serverName).toBe('client.example.com')
    expect(init.redirect).toBe('manual')
    expect(init.proxy).toBe(false)
  })

  test('keeps the port and pins IPv6 answers in brackets', async () => {
    const { pinned, sent } = transport(['2606:4700:10::ac42:93f3'])
    await pinned('https://client.example.com:8443/a?b=c')
    const [{ url, init }] = sent as [Sent]
    expect(url.href).toBe('https://[2606:4700:10::ac42:93f3]:8443/a?b=c')
    expect(new Headers(init.headers).get('host')).toBe(
      'client.example.com:8443',
    )
  })

  test.each([
    ['loopback', ['127.0.0.1']],
    ['private', ['10.1.2.3']],
    ['cloud metadata', ['169.254.169.254']],
    ['IPv6 loopback', ['::1']],
    ['IPv6 unique local', ['fd00::1']],
    ['IPv4-mapped loopback', ['::ffff:127.0.0.1']],
    ['a public address paired with a private one', ['1.1.1.1', '10.0.0.1']],
    ['a private address paired with a public one', ['10.0.0.1', '1.1.1.1']],
  ])('refuses a host resolving to %s', async (_, addresses) => {
    const { pinned, sent } = transport(addresses)
    await refused(pinned('https://client.example.com/oauth.json'))
    expect(sent).toHaveLength(0)
  })

  test.each([
    'https://127.0.0.1/oauth.json',
    'https://[::1]/oauth.json',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/',
  ])('refuses special-use literals without resolving them: %s', async (url) => {
    const { pinned, sent, lookups } = transport(['1.1.1.1'])
    await refused(pinned(url))
    expect(lookups).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  test('connects to a public literal without SNI', async () => {
    const { pinned, sent, lookups } = transport([])
    await pinned('https://1.1.1.1/oauth.json')
    expect(lookups).toHaveLength(0)
    const [{ url, init }] = sent as [Sent]
    expect(url.href).toBe('https://1.1.1.1/oauth.json')
    expect(init.tls?.serverName).toBeUndefined()
  })

  test('refuses hosts that resolve to nothing, or fail to resolve', async () => {
    await refused(transport([]).pinned('https://client.example.com/'))
    await refused(
      transport(new Error('ENOTFOUND')).pinned('https://client.example.com/'),
    )
  })

  test('refuses anything but HTTPS GET and HEAD, and credentials', async () => {
    const { pinned, sent } = transport(['1.1.1.1'])
    await refused(pinned('http://client.example.com/oauth.json'))
    await refused(pinned('file:///etc/passwd'))
    await refused(
      pinned('https://client.example.com/', { method: 'POST', body: '{}' }),
    )
    await refused(pinned('https://user:pass@client.example.com/'))
    expect(sent).toHaveLength(0)
    await pinned('https://client.example.com/', { method: 'HEAD' })
    expect(sent).toHaveLength(1)
  })

  test('returns redirects instead of following them', async () => {
    const { pinned, sent } = transport(
      ['1.1.1.1'],
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        }),
    )
    const response = await pinned('https://client.example.com/oauth.json', {
      redirect: 'follow',
    })
    expect(response.status).toBe(302)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.init.redirect).toBe('manual')
  })

  test("passes the caller's abort signal on", async () => {
    const { pinned, sent } = transport(['1.1.1.1'])
    const controller = new AbortController()
    await pinned('https://client.example.com/', { signal: controller.signal })
    controller.abort()
    expect(sent[0]?.init.signal?.aborted).toBe(true)
  })
})
