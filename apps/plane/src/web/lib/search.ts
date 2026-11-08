import { defaultPageSize, pageSizes, sortDirections } from '@shared/pagination'
import { z } from 'zod'

// Page state kept in the URL, so a reload or a shared link shows the same
// view. Invalid values fall back to the default, and values equal to their
// default are left out of the URL (`stripSearchParams` in each route).
export const text = z.string().default('').catch('')
export const list = z.array(z.string()).default([]).catch([])
export const optional = z.string().optional().catch(undefined)

// A paged table's page, page size and sort, newest first by default.
export const paged = <const Sorts extends readonly [string, ...string[]]>(
  sorts: Sorts,
  sort: Sorts[number],
) => ({
  page: z.number().int().min(1).default(1).catch(1),
  size: z.literal(pageSizes).default(defaultPageSize).catch(defaultPageSize),
  sort: z.enum(sorts).default(sort).catch(sort),
  dir: z.enum(sortDirections).default('desc').catch('desc'),
})
