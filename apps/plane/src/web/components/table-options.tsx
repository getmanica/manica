import { SlidersHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const toggle = (list: string[], item: string, on: boolean) =>
  on ? [...list, item] : list.filter((other) => other !== item)

// The sliders menu in a data table's toolbar: which values of one facet to
// show (e.g. statuses; none picked shows all), and which columns.
export const TableOptions = ({
  facet,
  options,
  selected,
  onSelectedChange,
  columns,
  hidden,
  onHiddenChange,
}: {
  facet: string
  options: { value: string; label: string }[]
  selected: string[]
  onSelectedChange: (selected: string[]) => void
  // The columns that can be hidden, by id.
  columns: { id: string; label: string }[]
  hidden: string[]
  onHiddenChange: (hidden: string[]) => void
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="outline"
          size={selected.length > 0 ? 'default' : 'icon'}
          aria-label="Filters and columns"
        />
      }
    >
      <SlidersHorizontalIcon />
      {selected.length > 0 && (
        <span className="rounded-sm bg-primary px-1 text-primary-foreground text-xs tabular-nums">
          {selected.length}
        </span>
      )}
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-48">
      <DropdownMenuGroup>
        <DropdownMenuLabel>{facet}</DropdownMenuLabel>
        {options.map(({ value, label }) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.includes(value)}
            onCheckedChange={(on) =>
              onSelectedChange(toggle(selected, value, on))
            }
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <DropdownMenuItem onClick={() => onSelectedChange([])}>
            <span className="text-muted-foreground">
              Clear {facet.toLowerCase()} filter
            </span>
          </DropdownMenuItem>
        )}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {columns.map(({ id, label }) => (
          <DropdownMenuCheckboxItem
            key={id}
            checked={!hidden.includes(id)}
            onCheckedChange={(on) => onHiddenChange(toggle(hidden, id, !on))}
          >
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)
