import { type PageSize, pageSizes } from '@shared/pagination'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react'
import { useEffect, useId } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type Pagination = {
  // From 1.
  page: number
  size: PageSize
  // How many rows match in all; unknown until the first page arrives.
  total: number | undefined
  onPageChange: (page: number) => void
  onSizeChange: (size: PageSize) => void
}

const sizeItems = pageSizes.map((size) => ({ label: `${size}`, value: size }))

// The footer of a paged data table: where the rows shown sit among all of
// them, how many to show at once, and buttons to move between pages.
export const TablePagination = ({
  page,
  size,
  total,
  onPageChange,
  onSizeChange,
  settled,
}: Pagination & {
  // `total` is up to date, not left from the previous page or filter.
  settled: boolean
}) => {
  const sizeLabel = useId()
  const pages = Math.max(1, Math.ceil((total ?? 0) / size))

  // Past the last page, e.g. after deleting its only row or a link to a page
  // that's since emptied: go to the last one there is.
  useEffect(() => {
    if (settled && total !== undefined && page > pages) onPageChange(pages)
  }, [settled, total, page, pages, onPageChange])

  if (!total) return null

  const first = Math.min((page - 1) * size + 1, total)
  const last = Math.min(page * size, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-1 text-muted-foreground text-sm">
      <p className="tabular-nums">
        {first}–{last} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span id={sizeLabel}>Rows per page</span>
          <Select
            items={sizeItems}
            value={size}
            onValueChange={(value) => value && onSizeChange(value)}
          >
            <SelectTrigger size="sm" aria-labelledby={sizeLabel}>
              <SelectValue className="tabular-nums" />
            </SelectTrigger>
            <SelectContent>
              {sizeItems.map(({ label, value }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="tabular-nums">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.min(page, pages) - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={page >= pages}
            onClick={() => onPageChange(pages)}
          >
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
