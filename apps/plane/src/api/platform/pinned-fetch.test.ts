import type { LookupAddress } from 'node:dns'
import { describe, expect, test } from 'vitest'
import {
  createPinnedFetch,
  createPinnedLookup,
  isSpecialUseAddress,
  PinnedFetchError,
} from './pinned-fetch'

type Sent = { url: URL; init: RequestInit & { dispatcher?: unknown } }

// A resolver answering `addresses` for every host (or failing), recording
// the hosts it was asked for.
const resolver = (addresses: string[] | Error) => {
  const lookups: string[] = []
  const resolve = async (hostname: string) => {
    lookups.push(hostname)
    if (addresses instanceof Error) throw addresses
    return addresses.map((address) => ({ address }))
  }
  return { resolve, lookups }
}

// A pinned fetch whose transport records what it would send instead of
// sending it.
const transport = (
  reply: () => Response = () => Response.json({ ok: true }),
) => {
  const sent: Sent[] = []
  const pinned = createPinnedFetch({
    resolve: resolver(['1.1.1.1']).resolve,
    fetch: (async (url: URL, init: Sent['init']) => {
      sent.push({ url, init })
      return reply()
    }) as unknown as typeof fetch,
  })
  return { pinned, sent }
}

// What the connection's lookup answers for `hostname`.
const look = (addresses: string[] | Error, all: boolean) =>
  new Promise<string | LookupAddress[]>((resolve, reject) =>
    createPinnedLookup(resolver(addresses).resolve)(
      'client.example.com',
      { all },
      (error, address) => (error ? reject(error) : resolve(address)),
    ),
  )

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

describe('pinned lookup', () => {
  test('answers every address the host resolves to, all being public', async () => {
    expect(
      await look(['93.184.215.14', '2606:4700:10::ac42:93f3'], true),
    ).toEqual([
      { address: '93.184.215.14', family: 4 },
      { address: '2606:4700:10::ac42:93f3', family: 6 },
    ])
    expect(await look(['93.184.215.14', '1.1.1.1'], false)).toBe(
      '93.184.215.14',
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
    await refused(look(addresses, true))
    await refused(look(addresses, false))
  })

  test('refuses hosts that resolve to nothing, or fail to resolve', async () => {
    await refused(look([], true))
    await refused(look(new Error('ENOTFOUND'), true))
  })
})

describe('pinned fetch', () => {
  test('sends the request as is, through its own connections', async () => {
    const { pinned, sent } = transport()
    const response = await pinned('https://client.example.com:8443/a?b=c', {
      headers: { accept: 'application/json' },
    })

    expect(response.status).toBe(200)
    const [{ url, init }] = sent as [Sent]
    // The hostname stays: it's the TLS server name and the certificate's.
    expect(url.href).toBe('https://client.example.com:8443/a?b=c')
    expect(new Headers(init.headers).get('accept')).toBe('application/json')
    expect(init.dispatcher).toBeDefined()
  })

  test.each([
    'https://127.0.0.1/oauth.json',
    'https://[::1]/oauth.json',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.1/',
  ])('refuses special-use literals: %s', async (url) => {
    const { pinned, sent } = transport()
    await refused(pinned(url))
    expect(sent).toHaveLength(0)
  })

  test('sends to public literals', async () => {
    const { pinned, sent } = transport()
    await pinned('https://1.1.1.1/oauth.json')
    expect(sent[0]?.url.href).toBe('https://1.1.1.1/oauth.json')
  })

  test('refuses anything but HTTPS GET and HEAD, and credentials', async () => {
    const { pinned, sent } = transport()
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
    const { pinned, sent } = transport()
    const controller = new AbortController()
    await pinned('https://client.example.com/', { signal: controller.signal })
    controller.abort()
    expect(sent[0]?.init.signal?.aborted).toBe(true)
  })

  test('rejects with the refusal, not the transport error wrapping it', async () => {
    const pinned = createPinnedFetch({
      fetch: (async () => {
        throw new TypeError('fetch failed', {
          cause: new PinnedFetchError(
            'client.example.com resolves to a special-use address',
          ),
        })
      }) as unknown as typeof fetch,
    })
    await refused(pinned('https://client.example.com/'))
  })
})
