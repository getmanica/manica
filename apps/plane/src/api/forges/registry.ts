import type { ForgeKind } from '../platform/db/schema'
import type { Forge } from './forge'
import { github } from './github/forge'

export const forges: Record<ForgeKind, Forge> = { github }
