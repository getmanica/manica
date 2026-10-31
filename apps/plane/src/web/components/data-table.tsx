import {
  type ColumnDef,
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
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Shared by every data table: client-side sorting by clicking a header.
const features = tableFeatures({
  rowSortingFeature,
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
}: {
  // Keep stable (module scope or memoized): new columns rebuild the table.
  // biome-ignore lint/suspicious/noExplicitAny: columns mix value types.
  columns: ColumnDef<Features, Row, any>[]
  data: Row[]
  getRowId: (row: Row) => string
  initialSorting?: SortingState
  // Shown in place of the rows when there are none.
  empty: ReactNode
}) => {
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    initialState: { sorting: initialSorting ?? [] },
  })
  const rows = table.getRowModel().rows

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
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
                    aria-sort={sorted ? ariaSort[sorted] : undefined}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                      >
                        {label}
                        {sorted === 'asc' && <ArrowUpIcon className="size-3" />}
                        {sorted === 'desc' && (
                          <ArrowDownIcon className="size-3" />
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
              <TableCell colSpan={columns.length}>{empty}</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
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
}
