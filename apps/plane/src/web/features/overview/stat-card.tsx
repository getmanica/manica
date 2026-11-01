import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { Skeleton } from '@/components/ui/skeleton'

// A headline number, linking to where it comes from.
export const StatCard = ({
  icon: Icon,
  label,
  value,
  detail,
  href,
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  detail: ReactNode
  href: string
}) => (
  <Link
    href={href}
    className="group flex items-start gap-4 rounded-2xl border bg-card p-5 transition-colors hover:bg-muted/40"
  >
    <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-semibold text-3xl tabular-nums tracking-tight">
        {value}
      </span>
      <span className="text-muted-foreground text-sm">{detail}</span>
    </div>
    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
  </Link>
)

// A stat card's place while its number loads.
export const StatCardSkeleton = ({
  icon: Icon,
  label,
}: {
  icon: LucideIcon
  label: string
}) => (
  <div className="flex items-start gap-4 rounded-2xl border bg-card p-5">
    <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-muted-foreground text-sm">{label}</span>
      <Skeleton className="my-1 h-7 w-16" />
      <Skeleton className="my-0.5 h-4 w-32" />
    </div>
  </div>
)

const percent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
})

// How a number moved since the previous range. `lowerIsBetter` colours a
// drop green and a rise red; without it, the change is shown as is.
export const Change = ({
  value,
  lowerIsBetter,
  since,
}: {
  value: number | null
  lowerIsBetter?: boolean
  since: string
}) => {
  if (value === null) return <>No data for the {since}</>
  const Arrow = value < 0 ? ArrowDownRightIcon : ArrowUpRightIcon
  const tone =
    lowerIsBetter === undefined || Math.round(value * 100) === 0
      ? 'text-foreground'
      : value < 0 === lowerIsBetter
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-destructive'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-0.5 font-medium ${tone}`}>
        <Arrow className="size-3.5" />
        {percent.format(value)}
      </span>
      vs. {since}
    </span>
  )
}
