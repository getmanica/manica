import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

// Fetching URLs that strangers pick (e.g. an MCP client's metadata document,
// whose URL is its client id), without letting them aim plane at itself or
// its network (SSRF): the host is resolved once, every address it resolves
// to must be public, the connection goes to the address that was checked
// (so DNS can't answer differently the second time), and redirects are
// returned, never followed.

// The special-purpose address registries (RFC 6890, as IANA keeps them),
// plus multicast. Ranges whose blocks are partly globally reachable (e.g.
// 192.0.0.0/24, 2001::/23) are refused whole. One list per family: a
// `BlockList` checks IPv4 addresses against IPv6 rules too, as IPv4-mapped
// addresses, so `::ffff:0:0/96` would otherwise refuse every IPv4 address.
const specialUseV4 = new BlockList()
const specialUseV6 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (CGNAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.31.196.0', 24], // AS112
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['192.175.48.0', 24], // AS112 direct delegation
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the limited broadcast address
] as const) {
  specialUseV4.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['2620:4f:8000::', 48], // AS112
  ['3fff::', 20], // documentation
  ['5f00::', 16], // segment routing
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  specialUseV6.addSubnet(network, prefix, 'ipv6')
}

// Whether `address` (an IP literal) is special-use, or not an IP at all.
export const isSpecialUseAddress = (address: string) => {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const family = isIP(bare)
  if (family === 4) return specialUseV4.check(bare, 'ipv4')
  if (family === 6) return specialUseV6.check(bare, 'ipv6')
  return true
}

export class PinnedFetchError extends Error {
  override readonly name = 'PinnedFetchError'
}

type Resolve = (hostname: string) => Promise<{ address: string }[]>

const resolveAll: Resolve = (hostname) =>
  lookup(hostname, { all: true, verbatim: true })

export const createPinnedFetch =
  ({ resolve = resolveAll, fetch: send = fetch } = {}) =>
  async (input: Request | string | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(input.toString(), init)
    const url = new URL(request.url)
    if (url.protocol !== 'https:') {
      throw new PinnedFetchError('Only HTTPS URLs can be fetched')
    }
    if (url.username || url.password) {
      throw new PinnedFetchError('URLs with credentials cannot be fetched')
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new PinnedFetchError('Only GET and HEAD requests can be made')
    }

    // Resolved once: the connection goes to an address checked here.
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await resolve(hostname).catch(() => {
          throw new PinnedFetchError(`Could not resolve ${hostname}`)
        })
    // Every answer must be public, not just the one used: otherwise a host
    // could pair a public address with a private one.
    if (addresses.length === 0) {
      throw new PinnedFetchError(`${hostname} resolves to no address`)
    }
    for (const { address } of addresses) {
      if (isSpecialUseAddress(address)) {
        throw new PinnedFetchError(
          `${hostname} resolves to a special-use address`,
        )
      }
    }
    const [pinned] = addresses as [{ address: string }]

    // The pinned address is connected to, while the hostname stays the HTTP
    // Host, the TLS server name, and the name the certificate must be for.
    const target = new URL(url)
    target.hostname =
      isIP(pinned.address) === 6 ? `[${pinned.address}]` : pinned.address
    const headers = new Headers(request.headers)
    headers.set('host', url.host)
    return send(target, {
      method: request.method,
      headers,
      signal: request.signal,
      // Redirects are the caller's to refuse: following one would reach a
      // host that was never checked.
      redirect: 'manual',
      // A proxy would do its own DNS resolution.
      proxy: false,
      // SNI carries names only, so an IP literal goes without.
      tls: isIP(hostname) ? {} : { serverName: hostname },
    } as BunFetchRequestInit)
  }

// For `@better-auth/cimd`, which fetches client metadata documents and the
// key sets they point at.
export const pinnedFetch = createPinnedFetch()
