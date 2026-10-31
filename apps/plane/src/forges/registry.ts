import type { Forge, ForgeKind } from './forge'
import { github } from './github/forge'

export const forges: Record<ForgeKind, Forge> = { github }
