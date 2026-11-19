import { failed } from '../checks'
import { VmBackendUnavailableError } from '../errors'
import { VM_PREFIX, type VmBackend, vmName } from '../vm/backend'
import { GuestCopyError, VmCleanupError } from '../vm/errors'
import { claimNamespace } from '../vm/namespace-lock'
import type { Installer, RunnerHost } from './host'
import { STOP_GRACE_MS } from './process'

// Where the runner build goes in the guest.
const GUEST_RUNNER_DIR = '$HOME/actions-runner'

// Unpacks a tar stream from stdin into the runner directory.
const UNPACK = `rm -rf "${GUEST_RUNNER_DIR}" && mkdir -p "${GUEST_RUNNER_DIR}" && tar -xf - -C "${GUEST_RUNNER_DIR}"`

// Records the runner's process group, which its session over SSH leads.
// Only if it does lead one: stopping must never signal another group.
const PID_FILE = `${GUEST_RUNNER_DIR}/.manica-pgid`

// Starts the runner with the JIT config read from the first line of stdin,
// rather than from argv, which other users of the guest could see. It exits
// with 7, instead of retrying, on a runner version GitHub deprecated.
const RUN = `IFS= read -r config
cd "${GUEST_RUNNER_DIR}" || exit 1
[ "$(ps -o pgid= -p $$ | tr -d ' ')" = "$$" ] && echo $$ > "${PID_FILE}"
export ACTIONS_RUNNER_INPUT_JITCONFIG="$config" ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE=1
unset config
exec "${GUEST_RUNNER_DIR}/run.sh"`

// Asks the runner to stop: SIGTERM to its whole process group (the
// listener, the worker, the job's steps), as on the host. Deleting the VM
// afterwards takes care of anything that ignores it.
const STOP = `pgid=$(cat "${PID_FILE}" 2>/dev/null) && [ -n "$pgid" ] && kill -TERM -- "-$pgid"; true`

// Deleting a job's VM is tried this many times before it's left for the
// next job to retry.
const DELETE_ATTEMPTS = 3

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

type Options = {
  backend: VmBackend
  // The stopped VM jobs are cloned from.
  image: string
  installer: Installer
  stopGraceMs?: number
  // Between attempts at deleting a VM.
  deleteRetryMs?: number
  // Where the backend namespace's lock goes (see claimNamespace).
  lockDir?: string
}

// Runs each runner in a fresh macOS VM cloned from `image`, deleted once
// the runner is done: nothing a job does outlives it, and it can't see the
// host's files or the agent's token.
export const createVmHost = ({
  backend,
  image,
  installer,
  stopGraceMs = STOP_GRACE_MS,
  deleteRetryMs = 2000,
  lockDir,
}: Options): RunnerHost & { check(): Promise<void> } => {
  // VMs of finished jobs that couldn't be deleted yet.
  const undeleted = new Set<string>()

  // Copies the build the host downloaded and verified into the guest.
  const copyBuild = async (vm: string, build: string, signal: AbortSignal) => {
    const tar = Bun.spawn(['tar', '-C', build, '-cf', '-', '.'], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal,
    })
    const lines: string[] = []
    const unpack = backend.exec(vm, ['/bin/sh', '-c', UNPACK], {
      stdin: tar.stdout,
      output: (line) => lines.push(line),
      signal,
    })
    const [tarExit, unpackExit] = await Promise.all([tar.exited, unpack.exited])
    if (tarExit !== 0) {
      throw new GuestCopyError(
        vm,
        `tar exited with ${tarExit}: ${await tar.stderr.text()}`,
      )
    }
    if (unpackExit !== 0) {
      throw new GuestCopyError(
        vm,
        `unpacking exited with ${unpackExit}: ${lines.slice(-3).join(' ')}`,
      )
    }
  }

  // Deletes `vm`, retrying a few times. If it still can't, it's kept for
  // the next job to retry first.
  const remove = async (vm: string, log: (line: string) => void) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await backend.delete(vm)
        undeleted.delete(vm)
        return
      } catch (error) {
        log(`deleting VM ${vm} failed: ${describe(error)}`)
        if (attempt >= DELETE_ATTEMPTS) {
          undeleted.add(vm)
          return
        }
        await Bun.sleep(deleteRetryMs)
      }
    }
  }

  // Runs the runner in a booted `vm` until it exits, or until it's been
  // stopped and its grace period ran out.
  const runInGuest = async (
    vm: string,
    config: string,
    signal: AbortSignal,
    output: (line: string) => void,
  ) => {
    const runner = backend.exec(vm, ['/bin/sh', '-c', RUN], {
      stdin: `${config}\n`,
      output,
    })
    let timer: Timer | undefined
    let stop = () => {}
    const gaveUp = new Promise<null>((resolve) => {
      stop = () => {
        void backend.exec(vm, ['/bin/sh', '-c', STOP]).exited
        timer = setTimeout(() => resolve(null), stopGraceMs)
      }
    })
    if (signal.aborted) stop()
    else signal.addEventListener('abort', stop, { once: true })
    try {
      return await Promise.race([runner.exited, gaveUp])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
    }
  }

  return {
    // Claims the backend's namespace for this agent, and fails if jobs
    // can't run with this backend and image, so the agent doesn't take jobs
    // it would only fail.
    async check() {
      const problems = failed(await backend.diagnose(image))
      if (problems.length > 0) {
        throw new VmBackendUnavailableError(
          backend.name,
          problems.map((check) => check.message),
        )
      }
      await claimNamespace(backend.namespace, lockDir)
    },

    // Deletes the VMs a previous agent left behind. Never the image, even
    // if its name looks like theirs (the config refuses that anyway).
    async clearStale() {
      for (const vm of await backend.list()) {
        if (!vm.startsWith(VM_PREFIX) || vm === image) continue
        console.log(`deleting VM ${vm}, left over by a previous agent`)
        await backend.delete(vm)
      }
    },

    async run({ id, name, config, build }, { signal, log, output }) {
      // No new VM while an old one may still run: the Mac can only run so
      // many, and the old one's job may not be over.
      for (const vm of undeleted) await remove(vm, log)
      if (undeleted.size > 0) throw new VmCleanupError([...undeleted])

      const vm = vmName(id)
      try {
        const installed = await installer.ensure(build)
        if (signal.aborted) return null
        log(`creating VM ${vm} from ${image}`)
        // Aborting kills what these run, and they reject.
        await backend.clone(image, vm, { signal })
        await backend.start(vm, { signal })
        await copyBuild(vm, installed, signal)
        if (signal.aborted) return null
        log(`starting runner ${name} in ${vm}`)
        return await runInGuest(vm, config, signal, output)
      } catch (error) {
        // Stopped while its VM was being made: it never ran.
        if (signal.aborted) return null
        throw error
      } finally {
        log(`deleting VM ${vm}`)
        await remove(vm, log)
      }
    },
  }
}
