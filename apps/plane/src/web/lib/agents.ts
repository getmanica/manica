import type { Treaty } from '@elysia/eden'
import type { api } from '@/lib/api'

export {
  builtInLabels,
  isValidLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_LENGTH,
} from '../../agents/labels'

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

const relativeTime = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
})

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
]

export const formatLastSeen = (lastSeenAt: Date | string | null) => {
  if (!lastSeenAt) return 'Never'
  const seconds = (new Date(lastSeenAt).getTime() - Date.now()) / 1000
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return relativeTime.format(Math.round(seconds / size), unit)
    }
  }
  return 'Just now'
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export const formatDate = (date: Date | string) =>
  dateFormat.format(new Date(date))
