import { createLima } from './lima'

// The VM backends the agent can drive, by the name `[vm] backend` takes.
export const BACKENDS = {
  lima: createLima,
} as const

export type BackendName = keyof typeof BACKENDS

export const BACKEND_NAMES = Object.keys(BACKENDS) as BackendName[]
