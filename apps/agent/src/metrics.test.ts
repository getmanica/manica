import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSampler, parseMeminfo, parseVmStat } from './metrics'

const GiB = 2 ** 30

test('reads used memory from vm_stat as Activity Monitor does', () => {
  const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     7133.
Pages active:                                 398940.
Pages inactive:                               396744.
Pages wired down:                             181591.
Pages purgeable:                                3289.
File-backed pages:                            269097.
Anonymous pages:                              527612.
Pages occupied by compressor:                 533445.
`
  // App memory (anonymous less purgeable), wired and compressed.
  const pages = 527612 - 3289 + 181591 + 533445
  expect(parseVmStat(output, 24 * GiB)).toBe(pages * 16384)
  expect(parseVmStat(output, GiB)).toBe(GiB)
  expect(() => parseVmStat('Pages free: 1.', GiB)).toThrow('page size')
})

test('reads used memory from /proc/meminfo', () => {
  const meminfo = 'MemTotal:  16384000 kB\nMemAvailable:  4194304 kB\n'
  expect(parseMeminfo(meminfo, 16 * GiB)).toBe(12 * GiB)
  expect(() => parseMeminfo('MemTotal: 1 kB\n', GiB)).toThrow('MemAvailable')
})

test('reads this machine', async () => {
  const sample = createSampler(tmpdir())
  const metrics = await sample()
  expect(metrics.cpu).toBeGreaterThanOrEqual(0)
  expect(metrics.cpu).toBeLessThanOrEqual(1)
  expect(metrics.memoryUsed).toBeGreaterThan(0)
  expect(metrics.memoryUsed).toBeLessThanOrEqual(metrics.memoryTotal)
  expect(metrics.diskUsed).toBeGreaterThan(0)
  expect(metrics.diskUsed).toBeLessThanOrEqual(metrics.diskTotal)
})

test('reads the disk of a data directory no job has made yet', async () => {
  const dataDir = join(
    tmpdir(),
    `manica-metrics-${crypto.randomUUID()}`,
    'data',
  )
  const metrics = await createSampler(dataDir)()
  expect(metrics.diskTotal).toBeGreaterThan(0)
})
