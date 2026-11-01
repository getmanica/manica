import { expect, test } from 'bun:test'
import { createDistribution, pickDistribution } from './distribution'

const sha = (char: string) => char.repeat(64)

const release = {
  tag_name: 'v2.338.2',
  body: [
    `<!-- BEGIN SHA osx-arm64 -->${sha('a')}<!-- END SHA osx-arm64 -->`,
    `<!-- BEGIN SHA linux-x64 -->${sha('b')}<!-- END SHA linux-x64 -->`,
  ].join('\n'),
  assets: [
    'actions-runner-osx-arm64-2.338.2.tar.gz',
    'actions-runner-linux-x64-2.338.2.tar.gz',
  ].map((name) => ({
    name,
    browser_download_url: `https://github.com/actions/runner/releases/download/v2.338.2/${name}`,
  })),
}

test('picks the build and checksum for the platform', () => {
  expect(pickDistribution(release, { os: 'darwin', arch: 'arm64' })).toEqual({
    version: '2.338.2',
    url: 'https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-osx-arm64-2.338.2.tar.gz',
    sha256: sha('a'),
  })
  expect(
    pickDistribution(release, { os: 'linux', arch: 'x86_64' })?.sha256,
  ).toBe(sha('b'))
})

test('has nothing for a platform without a build', () => {
  expect(
    pickDistribution(release, { os: 'linux', arch: 'arm64' }),
  ).toBeUndefined()
})

test('fetches the release once an hour', async () => {
  let calls = 0
  const distribution = createDistribution((async () => {
    calls++
    return Response.json(release)
  }) as unknown as typeof fetch)
  const mac = { os: 'darwin', arch: 'arm64' } as const
  expect((await distribution.for(mac))?.version).toBe('2.338.2')
  await distribution.for(mac)
  expect(calls).toBe(1)
})
