import { SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'

// The text box in a data table's toolbar.
export const TableFilter = ({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) => (
  <div className="relative w-full max-w-xs">
    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder.replace(/…$/, '')}
      className="pl-8"
    />
  </div>
)
