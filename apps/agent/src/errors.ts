// Errors the agent reports to the user and exits on, instead of crashing
// with a stack trace.
export class AgentError extends Error {
  override readonly name: string = 'AgentError'
}

export class UsageError extends AgentError {
  override readonly name = 'UsageError'
}

export class ConfigNotFoundError extends AgentError {
  override readonly name = 'ConfigNotFoundError'
  constructor(readonly path: string) {
    super(`No config file at ${path}`)
  }
}

export class InvalidConfigError extends AgentError {
  override readonly name = 'InvalidConfigError'
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`Invalid config ${path}: ${reason}`)
  }
}

export class VmBackendUnavailableError extends AgentError {
  override readonly name = 'VmBackendUnavailableError'
  constructor(
    readonly backend: string,
    readonly problems: string[],
  ) {
    super(
      `Jobs can't run in ${backend} VMs: ${problems.join('; ')} (run manica-agent doctor for details)`,
    )
  }
}

export class VmNamespaceInUseError extends AgentError {
  override readonly name = 'VmNamespaceInUseError'
  constructor(
    readonly namespace: string,
    readonly pid: number | null,
    readonly lock: string,
  ) {
    super(
      `Another agent${pid ? ` (pid ${pid})` : ''} runs jobs in VMs from ${namespace}: one agent at a time can, since each deletes the VMs it finds there on start (lock: ${lock})`,
    )
  }
}

export class TokenRejectedError extends AgentError {
  override readonly name = 'TokenRejectedError'
  constructor() {
    super(
      'The plane rejected the agent token: it may have been regenerated, or the agent deleted',
    )
  }
}
