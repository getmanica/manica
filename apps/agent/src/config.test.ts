import { expect, test } from 'bun:test'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDir } from '../test/build'
import { loadConfig } from './config'

const load = async (extra: string) => {
  const dir = await tempDir()
  await Bun.write(
    join(dir, 'config.toml'),
    `[plane]\nurl = "http://plane.test"\ntoken = "mna_x"\n${extra}`,
  )
  await chmod(join(dir, 'config.toml'), 0o600)
  return loadConfig(dir)
}

test('[vm] is optional', async () => {
  expect((await load('')).vm).toBeUndefined()
})

test('[vm] takes a known backend and an image', async () => {
  expect(
    (await load('[vm]\nbackend = "lima"\nimage = "manica-golden"\n')).vm,
  ).toEqual({ backend: 'lima', image: 'manica-golden' })
  await expect(
    load('[vm]\nbackend = "parallels"\nimage = "golden"\n'),
  ).rejects.toThrow('vm.backend: must be one of: lima')
})

test('the image can’t be named like the VMs jobs run in', async () => {
  await expect(
    load('[vm]\nbackend = "lima"\nimage = "manica-runner-golden"\n'),
  ).rejects.toThrow("vm.image: can't start with manica-runner-")
})

test('[metrics] is off unless enabled', async () => {
  expect((await load('')).metricsInterval).toBeUndefined()
  expect(
    (await load('[metrics]\ninterval = 60\n')).metricsInterval,
  ).toBeUndefined()
  expect((await load('[metrics]\nenabled = true\n')).metricsInterval).toBe(
    30_000,
  )
  expect(
    (await load('[metrics]\nenabled = true\ninterval = 60\n')).metricsInterval,
  ).toBe(60_000)
  await expect(
    load('[metrics]\nenabled = true\ninterval = 5\n'),
  ).rejects.toThrow('metrics.interval: must be at least 15 seconds')
})
