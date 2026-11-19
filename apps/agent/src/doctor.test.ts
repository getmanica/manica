import { expect, test } from 'bun:test'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDir } from '../test/build'
import { fail, ok, warn } from './checks'
import { diagnose, formatSections, healthy } from './doctor'
import type { VmBackend } from './vm/backend'

const writeConfig = async (extra = '') => {
  const dir = await tempDir()
  const dataDir = join(dir, 'data')
  await Bun.write(
    join(dir, 'config.toml'),
    `[plane]\nurl = "http://plane.test"\ntoken = "mna_x"\n\n[agent]\ndata_dir = "${dataDir}"\n${extra}`,
  )
  await chmod(join(dir, 'config.toml'), 0o600)
  return dir
}

const backend = (checks: VmBackend['diagnose']) => () =>
  ({ name: 'lima', diagnose: checks }) as VmBackend

const plane = async () => ok('http://plane.test accepted the agent token')

test('a config without [vm] doesn’t fail on a missing backend', async () => {
  const dir = await writeConfig()
  const images: (string | undefined)[] = []
  const sections = await diagnose(dir, {
    checkPlane: plane,
    backends: {
      lima: backend(async (image) => {
        images.push(image)
        return [fail('limactl not found', 'install Lima')]
      }),
    },
  })
  expect(healthy(sections)).toBe(true)
  expect(images).toEqual([undefined])
  const text = formatSections(sections)
  expect(text).toContain(
    'VM backend: lima (not used)\n  ✗ limactl not found\n      install Lima',
  )
  expect(text).toContain('jobs run on this machine')
})

test('the backend [vm] uses is checked with its image, and counts', async () => {
  const dir = await writeConfig('\n[vm]\nbackend = "lima"\nimage = "golden"\n')
  const images: (string | undefined)[] = []
  const sections = await diagnose(dir, {
    checkPlane: plane,
    backends: {
      lima: backend(async (image) => {
        images.push(image)
        return [ok('Lima 2.3.0'), fail(`no Lima instance named ${image}`)]
      }),
    },
  })
  expect(images).toEqual(['golden'])
  expect(healthy(sections)).toBe(false)
  expect(formatSections(sections)).toContain('VM backend: lima\n')
})

test('warnings don’t fail', async () => {
  const dir = await writeConfig('\n[vm]\nbackend = "lima"\nimage = "golden"\n')
  const sections = await diagnose(dir, {
    checkPlane: plane,
    backends: { lima: backend(async () => [warn('2 VMs running')]) },
  })
  expect(healthy(sections)).toBe(true)
})

test('a missing config fails, and the rest still runs', async () => {
  const sections = await diagnose(await tempDir(), {
    checkPlane: plane,
    backends: { lima: backend(async () => [ok('Lima 2.3.0')]) },
  })
  expect(healthy(sections)).toBe(false)
  expect(sections.map((s) => s.title)).toEqual([
    'Config',
    'This machine',
    'VM backend: lima (not used)',
  ])
})
