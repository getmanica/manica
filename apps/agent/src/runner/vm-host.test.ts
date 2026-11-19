import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { createBuild } from '../../test/build'
import { createFakeLimactl, golden } from '../../test/fake-limactl'
import { VmCleanupError, VmIsolationError } from '../vm/errors'
import { createLima, ISOLATED } from '../vm/lima'
import { createVmHost } from './vm-host'

// How a job's VM is cloned from `golden`.
const CLONE = `clone --tty=false ${ISOLATED.map((setting) => `--set ${setting}`).join(' ')} golden`

const build = { version: '1.0.0', url: 'unused', sha256: 'unused' }
const job = { id: 'r1', name: 'manica-r1', config: 'secret-jit', build }

const setup = async () => {
  const fake = await createFakeLimactl([golden])
  const template = await createBuild()
  const host = createVmHost({
    backend: createLima({ limactl: fake.limactl }),
    image: 'golden',
    installer: { ensure: async () => template },
    stopGraceMs: 200,
    deleteRetryMs: 10,
  })
  const log: string[] = []
  const output: string[] = []
  const run = (signal = new AbortController().signal) =>
    host.run(job, {
      signal,
      log: (line) => log.push(line),
      output: (line) => output.push(line),
    })
  return { fake, host, run, log, output }
}

test('runs the runner in a fresh VM, from the host’s build, then deletes it', async () => {
  const { fake, run, output } = await setup()
  process.env.EXIT_CODE = '3'
  try {
    expect(await run()).toBe(3)
  } finally {
    delete process.env.EXIT_CODE
  }
  // The build was copied into the guest and run from there, with the
  // config through stdin.
  expect(output).toContain('config=secret-jit args=')
  expect(
    await Bun.file(
      join(fake.guestHome('manica-runner-r1'), 'actions-runner', 'run.sh'),
    ).exists(),
  ).toBe(true)
  const calls = await fake.calls()
  expect(calls[0]).toBe(`${CLONE} manica-runner-r1`)
  expect(calls[1]).toBe('list --json manica-runner-r1')
  expect(calls[2]).toStartWith('start ')
  expect(calls.at(-1)).toBe('delete --force manica-runner-r1')
  expect(calls.join('\n')).not.toContain('secret-jit')
})

test('deletes the VM when it fails to start', async () => {
  const { fake, run } = await setup()
  process.env.FAKE_LIMA_FAIL_CLONE = '1'
  try {
    await expect(run()).rejects.toThrow('clone failed')
  } finally {
    delete process.env.FAKE_LIMA_FAIL_CLONE
  }
  expect((await fake.calls()).at(-1)).toBe('delete --force manica-runner-r1')
})

test('stops the runner, then deletes its VM', async () => {
  const { fake, run, output } = await setup()
  process.env.SLEEP = '30'
  const stop = new AbortController()
  try {
    const running = run(stop.signal)
    while (!output.some((line) => line.startsWith('config='))) {
      await Bun.sleep(20)
    }
    const stoppedAt = Date.now()
    stop.abort()
    await running
    expect(Date.now() - stoppedAt).toBeLessThan(5000)
  } finally {
    delete process.env.SLEEP
  }
  const calls = await fake.calls()
  expect(calls.some((call) => call.includes('kill -TERM'))).toBe(true)
  expect(calls.at(-1)).toBe('delete --force manica-runner-r1')
})

test('doesn’t start a VM once stopped', async () => {
  const { fake, run } = await setup()
  const stop = new AbortController()
  stop.abort()
  expect(await run(stop.signal)).toBeNull()
  expect(await fake.calls()).toEqual(['delete --force manica-runner-r1'])
})

test('clears the VMs a previous agent left, and only those', async () => {
  const fake = await createFakeLimactl([
    golden,
    { name: 'manica-runner-old', status: 'Running' },
    { name: 'manica-golden', status: 'Stopped' },
    { name: 'mine', status: 'Running' },
  ])
  const lima = createLima({ limactl: fake.limactl })
  await createVmHost({
    backend: lima,
    image: 'golden',
    installer: { ensure: async () => '' },
  }).clearStale()
  expect(await lima.list()).toEqual(['golden', 'manica-golden', 'mine'])
})

test('never clears the image, even named like a job’s VM', async () => {
  const fake = await createFakeLimactl([
    { ...golden, name: 'manica-runner-golden' },
  ])
  const lima = createLima({ limactl: fake.limactl })
  await createVmHost({
    backend: lima,
    image: 'manica-runner-golden',
    installer: { ensure: async () => '' },
  }).clearStale()
  expect(await lima.list()).toEqual(['manica-runner-golden'])
})

test('deletes a VM whose clone isn’t isolated, without starting it', async () => {
  const { fake, run } = await setup()
  process.env.FAKE_LIMA_GLOBAL_MOUNT = '1'
  try {
    await expect(run()).rejects.toBeInstanceOf(VmIsolationError)
  } finally {
    delete process.env.FAKE_LIMA_GLOBAL_MOUNT
  }
  const calls = await fake.calls()
  expect(calls.some((call) => call.startsWith('start '))).toBe(false)
  expect(calls.at(-1)).toBe('delete --force manica-runner-r1')
})

test('stopping while the VM boots kills the boot and deletes the VM', async () => {
  const { fake, run } = await setup()
  process.env.FAKE_LIMA_START_SLEEP = '30'
  const stop = new AbortController()
  try {
    const running = run(stop.signal)
    while (!(await fake.calls()).some((call) => call.startsWith('start '))) {
      await Bun.sleep(20)
    }
    const t0 = Date.now()
    stop.abort()
    expect(await running).toBeNull()
    expect(Date.now() - t0).toBeLessThan(2000)
  } finally {
    delete process.env.FAKE_LIMA_START_SLEEP
  }
  expect((await fake.calls()).at(-1)).toBe('delete --force manica-runner-r1')
})

test('a VM that can’t be deleted blocks new jobs until it is', async () => {
  const { fake, run, log } = await setup()
  process.env.FAKE_LIMA_FAIL_DELETE = '1'
  try {
    expect(await run()).toBe(0)
    expect(
      log.filter((line) =>
        line.startsWith('deleting VM manica-runner-r1 failed'),
      ),
    ).toHaveLength(3)
    await expect(run()).rejects.toBeInstanceOf(VmCleanupError)
  } finally {
    delete process.env.FAKE_LIMA_FAIL_DELETE
  }
  // Once it can be deleted, jobs run again.
  expect(await run()).toBe(0)
  expect(await createLima({ limactl: fake.limactl }).list()).toEqual(['golden'])
})
