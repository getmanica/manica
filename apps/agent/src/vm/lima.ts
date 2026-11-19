import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { type Check, fail, ok, warn } from '../checks'
import {
  checkHost,
  type ExecOptions,
  LONGEST_VM_NAME,
  MAX_RUNNING_MACOS_VMS,
  type VmBackend,
} from './backend'
import { compareVersions, forwardLines, runCommand } from './command'
import { VmCommandError, VmIsolationError } from './errors'

// macOS guests arrived in Lima 2.1; cutting a guest off from the host's
// loopback services (networkOpts.hostLoopback), in 2.3.
export const MIN_LIMA_VERSION = '2.3.0'

// How long `limactl start` may take to get a guest ready. It blocks for all
// of it when the guest never comes up (a 2 GiB macOS guest never does).
const START_TIMEOUT = '5m'

// Smaller macOS guests didn't boot when measured (macOS 27.2, Lima 2.3).
const MIN_MEMORY_BYTES = 3 * 1024 ** 3

const INSTALL_HINT =
  'install Lima 2.3 or later: https://lima-vm.io/docs/installation/'

// What a job's clone is set to, so it shares nothing with the host or with
// other jobs: no host directories, no disks (a clone shares the golden VM's,
// and they outlive it), no host devices, audio or microphone, no forwarded
// SSH agent or X11, no networks shared between VMs, and no access to the
// host's loopback services (which include the SSH port Lima forwards for
// every other VM, whose guest has the same user and password).
export const ISOLATED = [
  '.mounts = []',
  '.additionalDisks = []',
  '.blockDevices = []',
  '.audio.device = ""',
  '.audio.microphone = false',
  '.ssh.forwardAgent = false',
  '.ssh.forwardX11 = false',
  '.ssh.forwardX11Trusted = false',
  '.networks = []',
  '.networkOpts.hostLoopback = false',
]

// The parts of `limactl list --json` used here: one object per line.
type Instance = {
  name: string
  status?: string
  vmType?: string
  // Lima's effective config: the instance's own, merged with
  // $LIMA_HOME/_config/default.yaml and override.yaml.
  config?: {
    os?: string
    memory?: string
    mounts?: { location?: string }[]
    additionalDisks?: (string | { name?: string })[]
    blockDevices?: string[]
    audio?: { device?: string; microphone?: boolean }
    ssh?: {
      forwardAgent?: boolean
      forwardX11?: boolean
      forwardX11Trusted?: boolean
    }
    networks?: { lima?: string; socket?: string; vzNAT?: boolean }[]
    networkOpts?: { hostLoopback?: boolean }
  }
}

// macOS's limit on a Unix socket's path, terminator included.
const UNIX_PATH_MAX = 104

// The longest socket Lima's SSH makes in a VM's directory: ControlMaster's
// temporary ssh.sock.<16 random characters>.
const LONGEST_SOCKET = 'ssh.sock.0123456789abcdef'

// How long a command's output may take to drain once it exited: a process
// it started in the guest can hold the pipe until the VM is gone.
const DRAIN_MS = 1000

const UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
}

// Lima's memory sizes look like "4GiB".
export const parseSize = (size: string) => {
  const match = /^([\d.]+)\s*([KMGT]i)?B?$/.exec(size.trim())
  if (!match) return null
  return Number(match[1]) * (UNITS[`${match[2] ?? ''}B`] ?? 1)
}

type Options = {
  // The limactl to run. Defaults to the one on PATH.
  limactl?: string
  // Lima's home directory, where it keeps its VMs. Defaults to $LIMA_HOME,
  // or ~/.lima.
  home?: string
}

// Lima (https://lima-vm.io), with its vz driver: macOS guests on
// Virtualization.framework. It reaches guests over SSH through a port it
// forwards on 127.0.0.1, so it works from a headless session without Local
// Network access.
export const createLima = ({
  limactl = 'limactl',
  home = process.env.LIMA_HOME || join(homedir(), '.lima'),
}: Options = {}) => {
  const env = () => ({ ...process.env, LIMA_HOME: home })
  const run = (
    argv: string[],
    options: Parameters<typeof runCommand>[1] = {},
  ) => runCommand([limactl, ...argv], { env: env(), ...options })

  const instances = async (name?: string) => {
    const { stdout } = await run(['list', '--json', ...(name ? [name] : [])])
    return stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Instance)
  }

  const checkVersion = async (): Promise<Check> => {
    let output: string
    try {
      output = (await run(['--version'])).stdout
    } catch (error) {
      return error instanceof VmCommandError && error.exitCode === null
        ? fail(`${limactl} not found`, INSTALL_HINT)
        : fail(`${limactl} --version failed: ${String(error)}`, INSTALL_HINT)
    }
    const version = /(\d+\.\d+\.\d+)/.exec(output)?.[1]
    if (!version) return warn(`couldn't read Lima's version from "${output}"`)
    const where = Bun.which(limactl) ?? limactl
    return compareVersions(version, MIN_LIMA_VERSION) < 0
      ? fail(
          `Lima ${version} (${where}) is too old to isolate macOS guests`,
          INSTALL_HINT,
        )
      : ok(`Lima ${version} (${where})`)
  }

  const checkImage = (image: string, all: Instance[]): Check[] => {
    const golden = all.find((instance) => instance.name === image)
    if (!golden) {
      return [
        fail(
          `no Lima instance named ${image}`,
          `create it: limactl create --name=${image} template:macos, then start it once, install what jobs need, and stop it`,
        ),
      ]
    }
    const checks: Check[] = []
    if (golden.config?.os !== 'Darwin' || golden.vmType !== 'vz') {
      checks.push(
        fail(
          `${image} isn't a macOS guest (os ${golden.config?.os ?? '?'}, vmType ${golden.vmType ?? '?'})`,
        ),
      )
    }
    checks.push(
      golden.status === 'Stopped'
        ? ok(`${image}: stopped macOS instance, ready to clone`)
        : fail(
            `${image} is ${golden.status ?? 'in an unknown state'}: jobs are cloned from it stopped`,
            `limactl stop ${image}`,
          ),
    )
    const memory = parseSize(golden.config?.memory ?? '')
    if (memory !== null && memory < MIN_MEMORY_BYTES) {
      checks.push(
        warn(
          `${image} has ${golden.config?.memory} of memory: macOS guests under 3 GiB may never boot`,
          `limactl edit ${image} --memory=4`,
        ),
      )
    }
    return checks
  }

  // Lima refuses a VM whose sockets' paths are too long for macOS. It makes
  // them under its home made absolute, with symlinks resolved.
  const checkSocketPath = async (): Promise<Check> => {
    const resolved = await realpath(home).catch(() => resolve(home))
    const longest = join(resolved, LONGEST_VM_NAME, LONGEST_SOCKET)
    return Buffer.byteLength(longest) < UNIX_PATH_MAX
      ? ok(`Lima home ${resolved}`)
      : fail(
          `Lima home ${resolved} is too long: job VMs' sockets would exceed macOS's ${UNIX_PATH_MAX}-byte limit`,
          'set LIMA_HOME to a shorter directory for the agent and the golden VM',
        )
  }

  const checkRunning = (all: Instance[]): Check => {
    const running = all.filter((instance) => instance.status === 'Running')
    return running.length >= MAX_RUNNING_MACOS_VMS
      ? warn(
          `${running.length} Lima instances already running (${running.map((i) => i.name).join(', ')}): macOS runs at most ${MAX_RUNNING_MACOS_VMS} VMs at once`,
          'stop the ones jobs don’t need',
        )
      : ok(`${running.length} of ${MAX_RUNNING_MACOS_VMS} VMs in use by Lima`)
  }

  // What a job's VM would share with the host, after Lima merged in its
  // global config: refused rather than started.
  const checkIsolation = async (vm: string) => {
    const [instance] = await instances(vm)
    if (!instance?.config) {
      throw new VmIsolationError(vm, ['Lima didn’t report its config'])
    }
    const { config } = instance
    const reasons = [
      ...(config.mounts ?? []).map(
        (mount) => `it mounts ${mount.location ?? 'a host directory'}`,
      ),
      ...(config.additionalDisks ?? []).map(
        (disk) =>
          `it attaches disk ${typeof disk === 'string' ? disk : (disk.name ?? '?')}, which outlives it`,
      ),
      ...(config.blockDevices ?? []).map(
        (device) => `it attaches host device ${device}`,
      ),
      ...(config.audio?.device && config.audio.device !== 'none'
        ? [`it plays audio on the host (${config.audio.device})`]
        : []),
      ...(config.audio?.microphone ? ['it records the host’s microphone'] : []),
      ...(config.ssh?.forwardAgent ? ['it forwards the host’s SSH agent'] : []),
      ...(config.ssh?.forwardX11 || config.ssh?.forwardX11Trusted
        ? ['it forwards X11']
        : []),
      ...(config.networks ?? []).map(
        (network) =>
          `it joins network ${network.lima ?? network.socket ?? (network.vzNAT ? 'vzNAT' : '?')}, shared with other VMs`,
      ),
      ...(config.networkOpts?.hostLoopback !== false
        ? ['it reaches the host’s loopback services']
        : []),
    ]
    if (reasons.length > 0) throw new VmIsolationError(vm, reasons)
  }

  const backend: VmBackend = {
    name: 'lima',
    namespace: home,

    async diagnose(image) {
      const checks = [checkHost(), await checkVersion()]
      if (checks.some((check) => check.status === 'fail')) return checks
      checks.push(await checkSocketPath())
      let all: Instance[]
      try {
        all = await instances()
      } catch (error) {
        return [...checks, fail(`listing Lima instances failed: ${error}`)]
      }
      if (image) checks.push(...checkImage(image, all))
      checks.push(checkRunning(all))
      return checks
    },

    async clone(image, vm, { signal } = {}) {
      // The macOS template shares the host's home directory (read-only) by
      // default, and a golden VM may have anything else a VM can share (see
      // ISOLATED). Lima merges its global config back in, so what the clone
      // ends up with is checked too.
      await run(
        [
          'clone',
          '--tty=false',
          ...ISOLATED.flatMap((setting) => ['--set', setting]),
          image,
          vm,
        ],
        { signal },
      )
      await checkIsolation(vm)
    },

    async start(vm, { signal } = {}) {
      await run(['start', '--tty=false', `--timeout=${START_TIMEOUT}`, vm], {
        signal,
      })
    },

    exec(vm, argv, { stdin, output = () => {}, signal }: ExecOptions = {}) {
      // limactl quotes each argument, and runs them with the guest user's
      // login shell, over SSH. It doesn't forward the agent's environment.
      const child = Bun.spawn(
        [limactl, 'shell', '--workdir', '/', vm, ...argv],
        {
          env: env(),
          signal,
          stdin:
            typeof stdin === 'string' ? new Blob([stdin]) : (stdin ?? 'ignore'),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const forwarded = Promise.all([
        forwardLines(child.stdout, output),
        forwardLines(child.stderr, output),
      ])
      return {
        exited: child.exited.then(async (exitCode) => {
          await Promise.race([forwarded, Bun.sleep(DRAIN_MS)])
          return exitCode
        }),
      }
    },

    async delete(vm) {
      const { exitCode, stderr } = await run(['delete', '--force', vm], {
        check: false,
      })
      if (exitCode !== 0 && (await backend.list()).includes(vm)) {
        throw new VmCommandError(
          [limactl, 'delete', '--force', vm],
          exitCode,
          stderr.trim(),
        )
      }
    },

    async list() {
      const { stdout } = await run(['list', '--quiet'])
      return stdout.split('\n').filter((name) => name.trim())
    },
  }
  return backend
}
