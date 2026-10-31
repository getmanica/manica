import type { Forge, ForgeKind } from '../src/forges/forge'

const unexpected = (name: string) => () => {
  throw new Error(`Unexpected call to ${name}`)
}

// A forge whose methods fail unless a test provides them.
export const fakeForge = (overrides: Partial<Forge> = {}): Forge => ({
  kind: 'github',
  setup: unexpected('setup'),
  complete: unexpected('complete'),
  receive: unexpected('receive'),
  createRunner: unexpected('createRunner'),
  findRunner: unexpected('findRunner'),
  deleteRunner: unexpected('deleteRunner'),
  getJob: unexpected('getJob'),
  redeliverFailed: unexpected('redeliverFailed'),
  ...overrides,
})

export const forgesWith = (forge: Forge): Record<ForgeKind, Forge> => ({
  github: forge,
})
