// Errors driving a VM backend fails with. A job whose VM fails is given up
// on and reported as exited; the agent keeps going.

export class VmCommandError extends Error {
  override readonly name = 'VmCommandError'
  constructor(
    readonly argv: string[],
    // null if it couldn't be started at all.
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(
      `${argv.slice(0, 2).join(' ')} ${exitCode === null ? 'could not be started' : `exited with ${exitCode}`}` +
        (stderr ? `: ${stderr.split('\n').slice(-3).join(' ')}` : ''),
    )
  }
}

// A job's VM would share something with the host (a directory, forwarded
// credentials), from the backend's own config: it isn't started.
export class VmIsolationError extends Error {
  override readonly name = 'VmIsolationError'
  constructor(
    readonly vm: string,
    readonly reasons: string[],
  ) {
    super(`${vm} isn't isolated from the host: ${reasons.join('; ')}`)
  }
}

export class GuestCopyError extends Error {
  override readonly name = 'GuestCopyError'
  constructor(
    readonly vm: string,
    reason: string,
  ) {
    super(`Copying the runner into ${vm} failed: ${reason}`)
  }
}

// VMs of finished jobs that couldn't be deleted: no new job starts until
// they are, so they can't pile up past what the Mac can run.
export class VmCleanupError extends Error {
  override readonly name = 'VmCleanupError'
  constructor(readonly vms: string[]) {
    super(`VMs of finished jobs couldn't be deleted yet: ${vms.join(', ')}`)
  }
}
