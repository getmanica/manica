import { type Check, fail, ok } from '../checks'

// A process running in a guest, through the backend's CLI on the host.
export type GuestProcess = {
  // Its exit code, as the backend's CLI reports it.
  exited: Promise<number>
}

export type OperationOptions = {
  // Aborted to cancel the operation: its host processes are killed, and it
  // rejects. The VM may be left half made; delete it.
  signal?: AbortSignal
}

export type ExecOptions = OperationOptions & {
  // Fed to the process's stdin, then closed. Secrets go here rather than in
  // argv, which other users of the host can see.
  stdin?: string | ReadableStream<Uint8Array>
  // Called with each line of its stdout and stderr.
  output?: (line: string) => void
}

// A tool that runs macOS VMs on this Mac (Lima; later Tart, Lume), driven
// through its CLI. The user installs it: the agent doesn't ship one.
//
// Jobs run each in a VM of its own, cloned from a stopped "golden" VM the
// user prepared (the image), and deleted afterwards.
export type VmBackend = {
  readonly name: string
  // Where the tool keeps its VMs (for Lima, its home directory). One agent
  // at a time may use it: on start, an agent deletes the VMs it finds there
  // named like its own. Locked by its canonical path (see claimNamespace).
  readonly namespace: string
  // Whether the tool is installed and recent enough, and, given an image,
  // whether jobs can be cloned from it. Never throws: problems are checks.
  diagnose(image?: string): Promise<Check[]>
  // Makes `vm` a fresh copy of the stopped `image` that shares nothing with
  // the host or with other jobs: no host directories or devices, no disks
  // that outlive it, no forwarded credentials. Throws a VmIsolationError if
  // the tool's effective config for it still has any.
  clone(image: string, vm: string, options?: OperationOptions): Promise<void>
  // Boots `vm`, resolving once commands can run in it.
  start(vm: string, options?: OperationOptions): Promise<void>
  // Runs `argv` in `vm`, as the guest's user, in a session of its own (as
  // over SSH): it leads its process group, which stopping a runner signals.
  exec(vm: string, argv: string[], options?: ExecOptions): GuestProcess
  // Stops `vm` if it's running, and deletes it. Fine if it's already gone.
  delete(vm: string): Promise<void>
  // The names of every VM the tool knows of, running or not.
  list(): Promise<string[]>
}

// VMs the agent makes are named with this prefix, so a later agent can find
// the ones a previous one left behind and delete them. Nothing else may be:
// the image's name can't start with it.
export const VM_PREFIX = 'manica-runner-'

// A runner's VM: the prefix and the first 12 characters of its id (a
// UUID), which keeps the sockets backends make in a VM's directory under
// macOS's 104-byte limit for ordinary home directories.
export const vmName = (runnerId: string) =>
  `${VM_PREFIX}${runnerId.replaceAll('-', '').slice(0, 12)}`

// The longest name vmName makes.
export const LONGEST_VM_NAME = `${VM_PREFIX}${'x'.repeat(12)}`

// Virtualization.framework runs macOS guests on Apple silicon Macs only.
export const checkHost = (
  platform: string = process.platform,
  arch: string = process.arch,
): Check =>
  platform === 'darwin' && arch === 'arm64'
    ? ok('Apple silicon Mac: macOS guests are supported')
    : fail(`macOS VMs need an Apple silicon Mac (this is ${platform}-${arch})`)

// macOS allows two macOS guests running at once per Mac (its license, and
// Virtualization.framework refuses a third), whichever tool started them.
export const MAX_RUNNING_MACOS_VMS = 2
