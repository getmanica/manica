import type { JobRange } from '@shared/job-ranges'
import { CalendarIcon, ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const labels: Record<JobRange, string> = {
  '1h': 'Last hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All time',
}

export const rangeLabel = (range: JobRange) => labels[range]

// What a range is compared with, e.g. "previous day".
const previous: Record<JobRange, string> = {
  '1h': 'previous hour',
  '24h': 'previous day',
  '7d': 'previous week',
  '30d': 'previous 30 days',
  all: '',
}

export const previousRangeLabel = (range: JobRange) => previous[range]

// Picks how far back a page looks.
export const RangePicker = <Range extends JobRange>({
  ranges,
  value,
  onChange,
}: {
  ranges: readonly Range[]
  value: Range
  onChange: (range: Range) => void
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="outline" size="lg" />}>
      <CalendarIcon />
      {labels[value]}
      <ChevronDownIcon
        data-icon="inline-end"
        className="text-muted-foreground"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-40">
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(range) => onChange(range as Range)}
      >
        {ranges.map((range) => (
          <DropdownMenuRadioItem key={range} value={range} closeOnClick>
            {labels[range]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)
