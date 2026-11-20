import { type MetricRange, metricRanges } from '@shared/metric-ranges'
import { useQuery } from '@tanstack/react-query'
import { ActivityIcon } from 'lucide-react'
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { LoadError } from '@/components/loading'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type Agent,
  type AgentMetrics,
  type AgentMetricsPoint,
  agentMetricsQuery,
} from '@/features/agents/agents'
import { formatLastSeen } from '@/lib/format'

type Reading = NonNullable<Agent['metrics']>

const byteUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

// Binary multiples, as macOS shows memory: e.g. "15.8 GB".
export const formatBytes = (bytes: number) => {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${byteUnits[unit]}`
}

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`

const share = (used: number, total: number) => (total > 0 ? used / total : 0)

// Amber from 80%, red from 90%: worth a look before jobs start failing.
const levelClass = (fraction: number) =>
  fraction >= 0.9
    ? 'bg-destructive'
    : fraction >= 0.8
      ? 'bg-amber-500'
      : 'bg-primary'

const Meter = ({
  label,
  fraction,
  detail,
}: {
  label: string
  fraction: number
  detail: string
}) => (
  <span className="flex items-center gap-1.5" title={`${label}: ${detail}`}>
    <span className="w-8 text-muted-foreground text-xs">{label}</span>
    <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
      <span
        className={`block h-full rounded-full ${levelClass(fraction)}`}
        style={{ width: percent(Math.min(fraction, 1)) }}
      />
    </span>
    <span className="w-8 text-right text-xs tabular-nums">
      {percent(fraction)}
    </span>
  </span>
)

const meters = (reading: Reading) => [
  {
    label: 'CPU',
    fraction: reading.cpu,
    detail: `${percent(reading.cpu)} busy`,
  },
  {
    label: 'RAM',
    fraction: share(reading.memoryUsed, reading.memoryTotal),
    detail: `${formatBytes(reading.memoryUsed)} of ${formatBytes(reading.memoryTotal)}`,
  },
  {
    label: 'Disk',
    fraction: share(reading.diskUsed, reading.diskTotal),
    detail: `${formatBytes(reading.diskUsed)} of ${formatBytes(reading.diskTotal)}`,
  },
]

// The agent's current reading, in the agents list.
export const ResourceMeters = ({ reading }: { reading: Reading | null }) =>
  reading ? (
    <span className="flex flex-col gap-0.5">
      {meters(reading).map((meter) => (
        <Meter key={meter.label} {...meter} />
      ))}
    </span>
  ) : (
    <span className="text-muted-foreground">Not reported</span>
  )

const rangeLabels: Record<MetricRange, string> = {
  '1h': '1h',
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
}

// Axis labels: times of day for short ranges, days for long ones.
const tickFormats: Record<MetricRange, Intl.DateTimeFormatOptions> = {
  '1h': { hour: '2-digit', minute: '2-digit' },
  '24h': { hour: '2-digit', minute: '2-digit' },
  '7d': { weekday: 'short', hour: '2-digit' },
  '30d': { month: 'short', day: 'numeric' },
  '90d': { month: 'short', day: 'numeric' },
}

const tooltipFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

type Series = {
  key: 'cpu' | 'memory' | 'disk'
  title: string
  // The point's use, as a fraction, and what it amounts to.
  fraction: (point: AgentMetricsPoint) => number | null
  detail: (point: AgentMetricsPoint) => string | null
}

const series: Series[] = [
  {
    key: 'cpu',
    title: 'CPU',
    fraction: (point) => point.cpu,
    detail: () => null,
  },
  {
    key: 'memory',
    title: 'Memory',
    fraction: (point) =>
      point.memoryUsed === null || point.memoryTotal === null
        ? null
        : share(point.memoryUsed, point.memoryTotal),
    detail: (point) =>
      point.memoryUsed === null || point.memoryTotal === null
        ? null
        : `${formatBytes(point.memoryUsed)} of ${formatBytes(point.memoryTotal)}`,
  },
  {
    key: 'disk',
    title: 'Disk',
    fraction: (point) =>
      point.diskUsed === null || point.diskTotal === null
        ? null
        : share(point.diskUsed, point.diskTotal),
    detail: (point) =>
      point.diskUsed === null || point.diskTotal === null
        ? null
        : `${formatBytes(point.diskUsed)} of ${formatBytes(point.diskTotal)}`,
  },
]

const config = {
  value: { label: 'Used', color: 'var(--primary)' },
} satisfies ChartConfig

const isolated = (data: { value: number | null }[], index: number) =>
  data[index]?.value != null &&
  data[index - 1]?.value == null &&
  data[index + 1]?.value == null

// One resource's use over the range, as a percentage: gaps where the agent
// reported nothing.
const UsageChart = ({
  metrics,
  series: { key, title, fraction, detail },
}: {
  metrics: AgentMetrics
  series: Series
}) => {
  const format = new Intl.DateTimeFormat(undefined, tickFormats[metrics.range])
  const data = metrics.points.map((point) => {
    const used = fraction(point)
    return {
      start: new Date(point.start).getTime(),
      value: used === null ? null : Math.round(used * 1000) / 10,
      detail: detail(point),
    }
  })
  const fill = `fill-${key}`

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">{title}</h3>
      <ChartContainer config={config} className="aspect-auto h-36 w-full">
        <AreaChart data={data} margin={{ left: -16, right: 4, top: 4 }}>
          <defs>
            <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--color-value)"
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor="var(--color-value)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="start"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(value: number) => format.format(value)}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => `${value}%`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="line"
                labelFormatter={(_, payload) => {
                  const start = payload[0]?.payload?.start
                  return start ? tooltipFormat.format(start) : null
                }}
                formatter={(value, _, item) => (
                  <span className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">
                      {item.payload?.detail ?? 'Busy'}
                    </span>
                    <span className="font-medium font-mono tabular-nums">
                      {value}%
                    </span>
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={1.5}
            fill={`url(#${fill})`}
            isAnimationActive={false}
            // A reading between gaps draws no line (e.g. one every 10
            // minutes, on the 1h chart's minute points): it gets a dot.
            dot={({ index, cx, cy }) =>
              isolated(data, index) ? (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={2}
                  fill="var(--color-value)"
                />
              ) : (
                <g key={index} />
              )
            }
          />
        </AreaChart>
      </ChartContainer>
    </section>
  )
}

const Current = ({ metrics }: { metrics: AgentMetrics }) => {
  const reading = metrics.current
  if (!reading) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
        The agent isn't reporting metrics. Enable them in its config with{' '}
        <code className="font-mono text-xs">[metrics] enabled = true</code>.
      </p>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      {meters(reading).map(({ label, fraction, detail }) => (
        <div key={label} className="flex flex-col gap-1 rounded-lg border p-3">
          <span className="text-muted-foreground text-xs">{label}</span>
          <span className="font-semibold text-lg tabular-nums">
            {percent(fraction)}
          </span>
          <span className="text-muted-foreground text-xs">{detail}</span>
        </div>
      ))}
      <p className="col-span-3 text-muted-foreground text-xs">
        Updated {formatLastSeen(reading.recordedAt).toLowerCase()}
      </p>
    </div>
  )
}

// An agent's CPU, memory and disk use over a range, from the readings it
// reports.
export const AgentMetricsSheet = ({
  organizationId,
  agent,
  open,
  onOpenChange,
}: {
  organizationId: string | undefined
  agent: Agent | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const [range, setRange] = useState<MetricRange>('24h')
  const query = useQuery({
    ...agentMetricsQuery(organizationId, agent?.id, range),
    enabled: open && organizationId !== undefined && agent !== undefined,
  })
  const metrics = query.data

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ActivityIcon className="size-4 text-muted-foreground" />
            {agent?.name}
          </SheetTitle>
          <SheetDescription>
            CPU, memory and disk use the agent reports. Disk is the volume of
            its data directory.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          <Tabs
            value={range}
            onValueChange={(value) => setRange(value as MetricRange)}
          >
            <TabsList>
              {metricRanges.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {rangeLabels[value]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {query.isError && !metrics ? (
            <LoadError
              title="Couldn't load metrics"
              error={query.error}
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          ) : !metrics ? (
            <>
              <Skeleton className="h-24 w-full" />
              {series.map(({ key }) => (
                <Skeleton key={key} className="h-36 w-full" />
              ))}
            </>
          ) : (
            <div
              className={`flex flex-col gap-6 transition-opacity ${
                query.isPlaceholderData ? 'opacity-60' : ''
              }`}
            >
              <Current metrics={metrics} />
              {series.map((item) => (
                <UsageChart key={item.key} metrics={metrics} series={item} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
