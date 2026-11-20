import { expect, test } from 'bun:test'
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tempDir } from '../../test/build'
import { createFakeLimactl, golden } from '../../test/fake-limactl'
import { VmCommandError, VmIsolationError } from './errors'
import { createLima, ISOLATED, parseSize } from './lima'

// How a job's VM is cloned from `golden`.
const CLONE = `clone --tty=false ${ISOLATED.map((setting) => `--set ${setting}`).join(' ')} golden`

const statuses = (checks: { status: string }[]) => checks.map((c) => c.status)

// Most checks depend on the host: only Apple silicon Macs run macOS guests.
const onAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64'

test.if(onAppleSilicon)('a stopped macOS golden instance passes', async () => {
  const fake = await createFakeLimactl([golden])
  const checks = await createLima({ limactl: fake.limactl }).diagnose('golden')
  expect(statuses(checks)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
  expect(checks[1]?.message).toStartWith('Lima 2.3.0')
})

test('a missing limactl fails, with how to install it', async () => {
  const checks = await createLima({
    limactl: '/nonexistent/limactl',
  }).diagnose('golden')
  const last = checks.at(-1)
  expect(last?.status).toBe('fail')
  expect(last?.message).toBe('/nonexistent/limactl not found')
  expect(last?.hint).toContain('lima-vm.io')
})

test.if(onAppleSilicon)(
  'Lima before 2.3 fails: it can’t isolate guests',
  async () => {
    const fake = await createFakeLimactl([golden])
    process.env.FAKE_LIMA_VERSION = '2.2.1'
    try {
      const checks = await createLima({ limactl: fake.limactl }).diagnose(
        'golden',
      )
      expect(checks.at(-1)?.status).toBe('fail')
      expect(checks.at(-1)?.message).toContain(
        'too old to isolate macOS guests',
      )
    } finally {
      delete process.env.FAKE_LIMA_VERSION
    }
  },
)

test.if(onAppleSilicon)('golden instance problems', async () => {
  const fake = await createFakeLimactl([
    { ...golden, name: 'running', status: 'Running' },
    { ...golden, name: 'small', config: { os: 'Darwin', memory: '2GiB' } },
    { ...golden, name: 'linux', vmType: 'vz', config: { os: 'Linux' } },
  ])
  const lima = createLima({ limactl: fake.limactl })

  const missing = await lima.diagnose('nope')
  expect(missing[3]?.message).toBe('no Lima instance named nope')

  const running = await lima.diagnose('running')
  expect(running[3]?.status).toBe('fail')
  expect(running[3]?.hint).toBe('limactl stop running')

  const small = await lima.diagnose('small')
  expect(statuses(small)).toEqual(['ok', 'ok', 'ok', 'ok', 'warn', 'ok'])

  const linux = await lima.diagnose('linux')
  expect(linux[3]?.message).toContain("isn't a macOS guest")
})

test.if(onAppleSilicon)(
  'warns when the VM limit is already used up',
  async () => {
    const fake = await createFakeLimactl([
      golden,
      { name: 'a', status: 'Running' },
      { name: 'b', status: 'Running' },
    ])
    const checks = await createLima({ limactl: fake.limactl }).diagnose(
      'golden',
    )
    expect(checks.at(-1)?.status).toBe('warn')
    expect(checks.at(-1)?.message).toContain('2 Lima instances already running')
  },
)

test('clones without host mounts or agent forwarding, starts with a timeout, and deletes', async () => {
  const fake = await createFakeLimactl([golden])
  const lima = createLima({ limactl: fake.limactl })
  await lima.clone('golden', 'manica-r1')
  await lima.start('manica-r1')
  expect(await lima.list()).toEqual(['golden', 'manica-r1'])
  await lima.delete('manica-r1')
  expect(await lima.list()).toEqual(['golden'])
  expect(await fake.calls()).toEqual([
    `${CLONE} manica-r1`,
    'list --json manica-r1',
    'start --tty=false --timeout=5m manica-r1',
    'list --quiet',
    'delete --force manica-r1',
    'list --quiet',
  ])
})

test('exec feeds stdin and reports output and the exit code', async () => {
  const fake = await createFakeLimactl([golden])
  const lines: string[] = []
  const exited = createLima({ limactl: fake.limactl }).exec(
    'vm',
    ['/bin/sh', '-c', 'read -r x; echo "got $x"; echo oops >&2; exit 4'],
    { stdin: 'secret\n', output: (line) => lines.push(line) },
  ).exited
  expect(await exited).toBe(4)
  expect(lines.sort()).toEqual(['got secret', 'oops'])
  // The secret went through stdin, not the command line.
  expect((await fake.calls()).join('\n')).not.toContain('secret')
})

test('parses Lima memory sizes', () => {
  expect(parseSize('4GiB')).toBe(4 * 1024 ** 3)
  expect(parseSize('512MiB')).toBe(512 * 1024 ** 2)
  expect(parseSize('nonsense')).toBeNull()
})

test('refuses a clone Lima’s global config gives anything it shares with the host', async () => {
  const fake = await createFakeLimactl([golden])
  const lima = createLima({ limactl: fake.limactl })
  for (const [variable, reason] of [
    ['FAKE_LIMA_GLOBAL_MOUNT', 'it mounts /Users/host'],
    ['FAKE_LIMA_FORWARD_AGENT', 'it forwards the host’s SSH agent'],
    ['FAKE_LIMA_DISK', 'it attaches disk data, which outlives it'],
    ['FAKE_LIMA_HOST_LOOPBACK', 'it reaches the host’s loopback services'],
    ['FAKE_LIMA_MICROPHONE', 'it records the host’s microphone'],
  ] as const) {
    process.env[variable] = '1'
    try {
      const cloned = lima.clone('golden', `manica-${variable}`)
      await expect(cloned).rejects.toBeInstanceOf(VmIsolationError)
      await expect(cloned).rejects.toThrow(reason)
    } finally {
      delete process.env[variable]
    }
  }
})

test('aborting kills what an operation runs', async () => {
  const fake = await createFakeLimactl([golden])
  process.env.FAKE_LIMA_START_SLEEP = '30'
  try {
    const stop = new AbortController()
    const started = createLima({ limactl: fake.limactl }).start('vm', {
      signal: stop.signal,
    })
    await Bun.sleep(100)
    const t0 = Date.now()
    stop.abort()
    await expect(started).rejects.toBeInstanceOf(VmCommandError)
    expect(Date.now() - t0).toBeLessThan(2000)
  } finally {
    delete process.env.FAKE_LIMA_START_SLEEP
  }
})

test('uses its own Lima home as its namespace', async () => {
  expect(createLima({ home: '/tmp/lima-x' }).namespace).toBe('/tmp/lima-x')
})

test.if(onAppleSilicon)(
  'fails a Lima home too long for job VMs’ sockets',
  async () => {
    const fake = await createFakeLimactl([golden])
    const short = await createLima({
      limactl: fake.limactl,
      home: '/Users/someone/.lima',
    }).diagnose()
    expect(short[2]?.status).toBe('ok')
    const long = await createLima({
      limactl: fake.limactl,
      home: `/Users/${'a'.repeat(40)}/.lima`,
    }).diagnose()
    expect(long[2]?.status).toBe('fail')
    expect(long[2]?.message).toContain('104-byte limit')
  },
)

test.if(onAppleSilicon)(
  'measures the Lima home Lima uses: absolute, symlinks resolved',
  async () => {
    const fake = await createFakeLimactl([golden])
    const deep = join(await tempDir(), 'a'.repeat(60))
    await mkdir(deep)
    const alias = join(await tempDir(), 'l')
    await symlink(deep, alias)
    const viaAlias = await createLima({
      limactl: fake.limactl,
      home: alias,
    }).diagnose()
    expect(viaAlias[2]?.status).toBe('fail')
    expect(viaAlias[2]?.message).toContain(deep)
    const relative = await createLima({
      limactl: fake.limactl,
      home: '.',
    }).diagnose()
    expect(relative[2]?.message).toContain(process.cwd())
  },
)
