// The result of checking one thing the agent needs, as `doctor` prints it:
// `fail` means jobs can't run, `warn` that they may not run as expected.
export type Check = {
  status: 'ok' | 'warn' | 'fail'
  message: string
  // What to do about it, for a warning or a failure.
  hint?: string
}

export const ok = (message: string): Check => ({ status: 'ok', message })

export const warn = (message: string, hint?: string): Check => ({
  status: 'warn',
  message,
  hint,
})

export const fail = (message: string, hint?: string): Check => ({
  status: 'fail',
  message,
  hint,
})

export const failed = (checks: Check[]) =>
  checks.filter((check) => check.status === 'fail')
