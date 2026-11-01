import {
  type ColumnDef,
  type ColumnVisibilityState,
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  type RowData,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Shared by every data table: client-side sorting by clicking a header, and
// columns the page can hide.
const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
})

type Features = typeof features

export const createDataTableColumnHelper = <Row extends RowData>() =>
  createColumnHelper<Features, Row>()

const ariaSort = { asc: 'ascending', desc: 'descending' } as const

export const DataTable = <Row extends RowData>({
  columns,
  data,
  getRowId,
  initialSorting,
  empty,
  columnVisibility,
  toolbar,
}: {
  // Keep stable (module scope or memoized): new columns rebuild the table.
  // biome-ignore lint/suspicious/noExplicitAny: columns mix value types.
  columns: ColumnDef<Features, Row, any>[]
  data: Row[]
  getRowId: (row: Row) => string
  initialSorting?: SortingState
  // Shown in place of the rows when there are none.
  empty: ReactNode
  // Columns by id, hidden when false.
  columnVisibility?: ColumnVisibilityState
  // Controls shown above the table, e.g. filters.
  toolbar?: ReactNode
}) => {
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    initialState: { sorting: initialSorting ?? [] },
    state: columnVisibility ? { columnVisibility } : undefined,
  })
  const rows = table.getRowModel().rows

  const grid = (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/40">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                const label = header.isPlaceholder ? null : (
                  <table.FlexRender header={header} />
                )
                return (
                  <TableHead
                    key={header.id}
                    className="h-11 px-4"
                    aria-sort={sorted ? ariaSort[sorted] : undefined}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="group/sort -mx-1 inline-flex items-center gap-1.5 rounded px-1 hover:text-foreground"
                      >
                        {label}
                        {sorted === 'asc' ? (
                          <ArrowUpIcon className="size-3.5" />
                        ) : sorted === 'desc' ? (
                          <ArrowDownIcon className="size-3.5" />
                        ) : (
                          <ArrowUpDownIcon className="size-3.5 text-muted-foreground group-hover/sort:text-foreground" />
                        )}
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={table.getVisibleLeafColumns().length}>
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-4 py-3">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )

  if (!toolbar) return grid
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3">
      <div className="flex items-center justify-end gap-2">{toolbar}</div>
      {grid}
    </div>
  )
}
