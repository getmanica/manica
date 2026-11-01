// Dates as the console shows them.

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

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

export const formatTime = (date: Date | string) =>
  timeFormat.format(new Date(date))
