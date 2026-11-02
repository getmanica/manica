import { type AnyColumn, asc, type SQL, sql } from 'drizzle-orm'
import { t } from 'elysia'
import {
  defaultPageSize,
  type PageSize,
  pageSizes,
  type SortDirection,
  sortDirections,
} from '../../shared/pagination'

// The query a paged list takes: which page (from 1), how many rows per page,
// which of `sorts` to sort by and which way, and the filter box's text.
export const listQuery = <const Sorts extends readonly [string, ...string[]]>(
  sorts: Sorts,
) => ({
  page: t.Optional(t.Integer({ minimum: 1 })),
  size: t.Optional(t.UnionEnum(pageSizes)),
  sort: t.Optional(t.UnionEnum(sorts)),
  dir: t.Optional(t.UnionEnum(sortDirections)),
  q: t.Optional(t.String({ maxLength: 200 })),
})

export type ListOptions<Sort extends string> = {
  page?: number
  size?: PageSize
  sort?: Sort
  dir?: SortDirection
  q?: string
}

// The rows of the page asked for. Past the last page there are none.
export const pageWindow = ({
  page = 1,
  size = defaultPageSize,
}: ListOptions<string>) => ({ limit: size, offset: (page - 1) * size })

// Sorts by `by`, rows without a value last either way (e.g. never-seen
// agents), then by `tiebreak` so rows that sort the same keep their place
// from one page to the next.
export const sortBy = (
  by: SQL | AnyColumn,
  dir: SortDirection,
  tiebreak: AnyColumn,
) => [
  sql`${by} ${sql.raw(dir === 'desc' ? 'desc' : 'asc')} nulls last`,
  asc(tiebreak),
]

// The filter box's text, trimmed, or nothing if it's blank.
export const filterText = (q: string | undefined) => q?.trim() || undefined

// An ILIKE pattern for values containing `text`, its wildcards matched
// literally.
export const containing = (text: string) =>
  `%${text.replace(/[\\%_]/g, '\\$&')}%`
