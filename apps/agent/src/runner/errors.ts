// Errors starting a runner fails with: the runner is given up on and
// reported as exited, the agent keeps going.

export class RunnerInstallError extends Error {
  override readonly name = 'RunnerInstallError'
  constructor(
    readonly version: string,
    readonly reason: string,
    // Where the downloaded archive was kept, if it got that far.
    readonly archive?: string,
  ) {
    super(
      `Installing runner ${version} failed: ${reason}` +
        (archive ? ` (archive kept at ${archive})` : ''),
    )
  }
}

export class UnsupportedPlatformError extends Error {
  override readonly name = 'UnsupportedPlatformError'
  constructor() {
    super(`Running jobs on ${process.platform} isn't supported yet`)
  }
}
