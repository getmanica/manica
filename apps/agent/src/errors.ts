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

export class TokenRejectedError extends AgentError {
  override readonly name = 'TokenRejectedError'
  constructor() {
    super(
      'The plane rejected the agent token: it may have been regenerated, or the agent deleted',
    )
  }
}
