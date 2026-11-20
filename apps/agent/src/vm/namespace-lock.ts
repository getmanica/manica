import { dlopen, FFIType } from 'bun:ffi'
import { createHash } from 'node:crypto'
import {
  closeSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { VmNamespaceInUseError } from '../errors'

// Where locks go: under the home directory, so every agent of this user
// finds the same one, whatever its config or data directory.
export const defaultLockDir = () => join(homedir(), '.cache', 'manica')

// flock(2): an exclusive lock the kernel holds for the open file, and
// releases when it's closed, which it is when the process exits, however
// it does. Nothing stale is ever left, whatever happens to the agent.
const LOCK_EX = 2
const LOCK_NB = 4

let flock: ((fd: number, operation: number) => number) | undefined
const lockFile = (fd: number) => {
  if (!flock) {
    const { symbols } = dlopen(
      process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6',
      { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } },
    )
    flock = symbols.flock
  }
  return flock(fd, LOCK_EX | LOCK_NB) === 0
}

// The same directory however it's written: trailing slashes, `..`,
// symlinks.
const canonical = (dir: string) => realpath(dir).catch(() => resolve(dir))

// The locks this process holds, by path: their files stay open (and locked)
// for as long as it runs.
const held = new Map<string, number>()

// Claims a backend's namespace for this process, for as long as it runs:
// throws a VmNamespaceInUseError if another process holds it. An agent
// deletes the VMs it finds there named like its own, so two sharing one
// would delete each other's jobs.
export const claimNamespace = async (
  namespace: string,
  lockDir: string = defaultLockDir(),
) => {
  const id = await canonical(namespace)
  const hash = createHash('sha256').update(id).digest('hex').slice(0, 16)
  const path = join(lockDir, `vm-${hash}.lock`)
  if (held.has(path)) return path
  await mkdir(lockDir, { recursive: true, mode: 0o700 })
  // Opened close-on-exec (as Node and Bun open files), so processes the
  // agent starts, like Lima's host agents, don't keep it locked.
  const fd = openSync(path, 'a+', 0o600)
  if (!lockFile(fd)) {
    closeSync(fd)
    const holder = Number(readFileSync(path, 'utf8').trim())
    throw new VmNamespaceInUseError(
      id,
      Number.isInteger(holder) && holder > 0 ? holder : null,
      path,
    )
  }
  held.set(path, fd)
  // Who holds it, for the message another agent shows.
  ftruncateSync(fd, 0)
  writeSync(fd, String(process.pid))
  return path
}
