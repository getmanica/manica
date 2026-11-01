import type { OverviewRange } from '@shared/job-ranges'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { Overview } from '@/features/overview/overview'

// Literal colours (Tailwind's emerald-500 and zinc-500): Tailwind only defines
// the theme variables of the classes in use.
const grey = 'oklch(0.552 0.016 285.938)'
const config = {
  succeeded: { label: 'Succeeded', color: 'oklch(0.696 0.17 162.48)' },
  failed: { label: 'Failed', color: 'var(--destructive)' },
  cancelled: { label: 'Cancelled', color: grey },
  other: { label: 'Other', color: grey },
} satisfies ChartConfig

const series = ['succeeded', 'failed', 'cancelled', 'other'] as const

// Axis labels: times of day for short ranges, days for long ones.
const tickFormats: Record<OverviewRange, Intl.DateTimeFormatOptions> = {
  '1h': { hour: '2-digit', minute: '2-digit' },
  '24h': { hour: '2-digit', minute: '2-digit' },
  '7d': { weekday: 'short', hour: '2-digit' },
  '30d': { month: 'short', day: 'numeric' },
}

const tooltipFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const Legend = () => (
  <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-sm">
    {series.map((key) => (
      <span key={key} className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{
            background: config[key].color,
            opacity: key === 'other' ? 0.4 : 1,
          }}
        />
        {config[key].label}
      </span>
    ))}
  </div>
)

// Finished jobs over the range, a bar per bucket, stacked by how they ended.
export const JobRunsChart = ({ overview }: { overview: Overview }) => {
  const format = new Intl.DateTimeFormat(undefined, tickFormats[overview.range])
  const data = overview.buckets.map((bucket) => ({
    ...bucket,
    start: new Date(bucket.start).getTime(),
  }))
  const empty = data.every(
    (bucket) =>
      bucket.succeeded + bucket.failed + bucket.cancelled + bucket.other === 0,
  )

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold">Job runs</h2>
          <p className="text-muted-foreground text-sm">
            Finished jobs over time, grouped by result.
          </p>
        </div>
        <Legend />
      </div>
      <div className="relative">
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <BarChart data={data} margin={{ left: -16, right: 0, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="start"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(value: number) => format.format(value)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={40}
            />
            <ChartTooltip
              cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const start = payload[0]?.payload?.start
                    return start ? tooltipFormat.format(start) : null
                  }}
                />
              }
            />
            {series.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="jobs"
                fill={`var(--color-${key})`}
                fillOpacity={key === 'other' ? 0.4 : 1}
                maxBarSize={32}
                radius={index === series.length - 1 ? [3, 3, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ChartContainer>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
            No finished jobs in this range.
          </p>
        )}
      </div>
    </section>
  )
}
