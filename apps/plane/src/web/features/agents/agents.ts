import type { Treaty } from '@elysia/eden'
import type { api } from '@/lib/api'

export {
  builtInLabels,
  isValidLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_LENGTH,
} from '@shared/labels'

export type Agent = Treaty.Data<(typeof api)['agents']['get']>[number]

export const osLabels: Record<Agent['os'], string> = {
  linux: 'Linux',
  darwin: 'macOS',
  windows: 'Windows',
}

export const archLabels: Record<Agent['arch'], string> = {
  arm64: 'ARM64',
  x86_64: 'x86-64',
}

// e.g. "macOS ARM64".
export const formatPlatform = ({ os, arch }: Pick<Agent, 'os' | 'arch'>) =>
  `${osLabels[os]} ${archLabels[arch]}`
