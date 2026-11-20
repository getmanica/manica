// End-to-end check of running jobs in VMs with a real backend, on an Apple
// silicon Mac that has it installed and a stopped golden VM:
//
//   bun build --compile test/e2e/vm.ts --outfile dist/e2e-vm
//   ./dist/e2e-vm <image> [data dir]
//
// With the real actions/runner build and a bogus JIT config, the runner must
// start in the guest and fail on the config, with its exit code coming
// back. With a stand-in build that sleeps, stopping must stop it and delete
// its VM. Stopping a job while its VM boots must kill the boot. A host mount
// added back by Lima's global config must be refused. No VM made here may be
// left behind. Exits with 1 on a failure.
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatSections } from '../../src/doctor'
import { createInstaller } from '../../src/runner/install'
import { createVmHost } from '../../src/runner/vm-host'
import { VM_PREFIX } from '../../src/vm/backend'
import { VmIsolationError } from '../../src/vm/errors'
import { createLima } from '../../src/vm/lima'

const RUNNER = {
  version: '2.338.2',
  url: 'https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-osx-arm64-2.338.2.tar.gz',
  sha256: '25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388',
}

const [image = 'manica-golden', dataDir] = process.argv.slice(2)
const started = Date.now()
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(7)
const log = (line: string) => console.log(`${stamp()} ${line}`)
let failures = 0
const expect = (ok: boolean, what: string) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
  if (!ok) failures++
}

const backend = createLima()
const checks = await backend.diagnose(image)
console.log(formatSections([{ title: 'diagnose', checks, counts: true }]))
expect(
  checks.every((check) => check.status !== 'fail'),
  'diagnose finds nothing failing',
)

const dir = dataDir ?? (await mkdtemp(join(tmpdir(), 'manica-e2e-')))
const installer = createInstaller(join(dir, 'builds'))
const host = createVmHost({ backend, image, installer, stopGraceMs: 5000 })
// Like the agent: claim the namespace first, so this never deletes the VMs
// of an agent running alongside.
await host.check()
await host.clearStale()

// 1. The real runner, with a config it can't parse.
{
  const output: string[] = []
  const t0 = Date.now()
  const exitCode = await host.run(
    {
      id: 'e2e-real',
      name: 'e2e-real',
      config: Buffer.from('{"a":"b"}').toString('base64'),
      build: RUNNER,
    },
    {
      signal: new AbortController().signal,
      log,
      output: (line) => {
        output.push(line)
        log(`  [guest] ${line.slice(0, 160)}`)
      },
    },
  )
  log(
    `real runner: exit code ${exitCode} after ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  // run.sh exits 0 on a config it can't parse ("terminated error, no retry
  // needed"); exit codes coming through is checked with the stand-in below.
  expect(exitCode === 0, 'it ran to completion (run.sh exits 0 here)')
  expect(
    output.some((line) => /Base-64|FormatException|JIT|jitconfig/i.test(line)),
    'it ran in the guest and failed on the config',
  )
}

// 2. A stand-in that sleeps, stopped while it runs.
{
  // limactl doesn't forward the agent's environment, so this stand-in
  // sleeps unconditionally (test/build's RUN_SH takes $SLEEP). It exits
  // with 3 on SIGTERM, as a runner stopping cleanly, while its child (not
  // started from the runner's directory) must be stopped with the group.
  const template = await mkdtemp(join(tmpdir(), 'manica-e2e-build-'))
  await Bun.write(
    join(template, 'run.sh'),
    '#!/bin/bash\ntrap "echo got TERM; exit 3" TERM\necho "config=$ACTIONS_RUNNER_INPUT_JITCONFIG args=$*"\nsleep 600 &\nwait\n',
  )
  await chmod(join(template, 'run.sh'), 0o755)
  const stand = createVmHost({
    backend,
    image,
    installer: { ensure: async () => template },
    stopGraceMs: 5000,
  })
  const output: string[] = []
  const stop = new AbortController()
  const running = stand.run(
    { id: 'e2e-stop', name: 'e2e-stop', config: 'secret-jit', build: RUNNER },
    {
      signal: stop.signal,
      log,
      output: (line) => {
        output.push(line)
        log(`  [guest] ${line}`)
      },
    },
  )
  const deadline = Date.now() + 180_000
  while (
    !output.some((line) => line.startsWith('config=')) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(200)
  }
  expect(
    output.includes('config=secret-jit args='),
    'the config reached the runner through stdin',
  )
  const t0 = Date.now()
  stop.abort()
  const exitCode = await running
  log(
    `stand-in: stopped with ${exitCode} after ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  expect(exitCode === 3, 'its exit code came back through the backend')
  expect(
    Date.now() - t0 < 4000,
    'it stopped on SIGTERM, before the grace period ran out',
  )
}

// 3. Stopped while its VM boots: the boot is killed and the VM deleted.
{
  const stop = new AbortController()
  const running = host.run(
    { id: 'e2e-boot', name: 'e2e-boot', config: 'unused', build: RUNNER },
    { signal: stop.signal, log, output: () => {} },
  )
  // Clone takes well under a second; then the boot (~15 s).
  await Bun.sleep(3000)
  const t0 = Date.now()
  stop.abort()
  const exitCode = await running
  log(
    `stopped while booting: ${exitCode} after ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  expect(exitCode === null, 'it never ran')
  expect(Date.now() - t0 < 10_000, 'stopping it took under 10 s')
}

// 4. Lima's global config adds a host mount back: the clone is refused,
// never started. Skipped if the user has an override.yaml of their own.
{
  const override = join(backend.namespace, '_config', 'override.yaml')
  if (await Bun.file(override).exists()) {
    log(`SKIP global mount check: ${override} exists`)
  } else {
    await mkdir(join(backend.namespace, '_config'), { recursive: true })
    await Bun.write(override, 'mounts:\n- location: "~"\n')
    try {
      const error = await host
        .run(
          {
            id: 'e2e-mount',
            name: 'e2e-mount',
            config: 'unused',
            build: RUNNER,
          },
          { signal: new AbortController().signal, log, output: () => {} },
        )
        .then(
          () => null,
          (error: unknown) => error,
        )
      log(`with a global mount: ${String(error)}`)
      expect(
        error instanceof VmIsolationError,
        'a clone that would mount a host directory is refused',
      )
    } finally {
      await rm(override)
    }
  }
}

const left = (await backend.list()).filter((vm) => vm.startsWith(VM_PREFIX))
expect(
  left.length === 0,
  `no ${VM_PREFIX}* VM left behind (${left.join(', ') || 'none'})`,
)
log(failures === 0 ? 'all passed' : `${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
