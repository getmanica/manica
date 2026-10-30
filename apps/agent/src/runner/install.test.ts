import { afterAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createBuild, tempDir } from '../../test/build'
import { createInstaller } from './install'

// A tarball of the stand-in build, served like a release asset.
const build = await createBuild()
const tarball = join(await tempDir(), 'runner.tar.gz')
await Bun.spawn(['tar', '-czf', tarball, '-C', build, '.']).exited
const bytes = await Bun.file(tarball).bytes()
const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

let downloads = 0
const server = Bun.serve({
  port: 0,
  fetch: () => {
    downloads++
    return new Response(bytes)
  },
})
afterAll(() => server.stop())

const release = (version: string, checksum = sha256) => ({
  version,
  url: `${server.url}runner.tar.gz`,
  sha256: checksum,
})

test('downloads, verifies and extracts a build once', async () => {
  const installer = createInstaller(await tempDir())
  const before = downloads
  const [dir, again] = await Promise.all([
    installer.ensure(release('1.0.0')),
    installer.ensure(release('1.0.0')),
  ])
  expect(dir).toBe(again)
  expect(await Bun.file(join(dir, 'run.sh')).exists()).toBe(true)
  await installer.ensure(release('1.0.0'))
  expect(downloads - before).toBe(1)
})

test('keeps installed builds across agents', async () => {
  const dir = await tempDir()
  await createInstaller(dir).ensure(release('1.0.0'))
  const before = downloads
  await createInstaller(dir).ensure(release('1.0.0'))
  expect(downloads).toBe(before)
})

test('rejects a build whose checksum doesn’t match', async () => {
  const dir = await tempDir()
  const installer = createInstaller(dir)
  await expect(
    installer.ensure(release('1.0.0', '0'.repeat(64))),
  ).rejects.toThrow('checksum mismatch')
  expect(await Bun.file(join(dir, '1.0.0', 'run.sh')).exists()).toBe(false)
  expect(await Bun.file(join(dir, '1.0.0.failed.tar.gz')).bytes()).toEqual(
    bytes,
  )
})

test('drops the kept archive once a build installs', async () => {
  const dir = await tempDir()
  const installer = createInstaller(dir)
  await installer.ensure(release('1.0.0', '0'.repeat(64))).catch(() => {})
  await installer.ensure(release('1.0.0'))
  expect(await Bun.file(join(dir, '1.0.0.failed.tar.gz')).exists()).toBe(false)
})

test('rejects a build that isn’t a tarball', async () => {
  const garbage = Bun.serve({
    port: 0,
    fetch: () => new Response('not a tarball'),
  })
  try {
    const dir = await tempDir()
    const checksum = new Bun.CryptoHasher('sha256')
      .update('not a tarball')
      .digest('hex')
    await expect(
      createInstaller(dir).ensure({
        version: '1.0.0',
        url: `${garbage.url}runner.tar.gz`,
        sha256: checksum,
      }),
    ).rejects.toThrow('extracting failed')
    expect(await Bun.file(join(dir, '1.0.0', 'run.sh')).exists()).toBe(false)
    expect(await Bun.file(join(dir, '1.0.0.failed.tar.gz')).text()).toBe(
      'not a tarball',
    )
  } finally {
    garbage.stop()
  }
})
