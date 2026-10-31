// Errors starting a runner fails with: the runner is given up on and
// reported as exited, the agent keeps going.

export class RunnerInstallError extends Error {
  override readonly name = 'RunnerInstallError'
  constructor(version: string, reason: string) {
    super(`Installing runner ${version} failed: ${reason}`)
  }
}

export class UnsupportedPlatformError extends Error {
  override readonly name = 'UnsupportedPlatformError'
  constructor() {
    super(`Running jobs on ${process.platform} isn't supported yet`)
  }
}
