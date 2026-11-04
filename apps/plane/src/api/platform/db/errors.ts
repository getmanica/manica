import { SQL } from 'bun'
import { DrizzleQueryError } from 'drizzle-orm'

// Whether a query failed on the given unique constraint. Bun SQL reports
// Postgres' SQLSTATE as `errno` (its `code` is Bun's own).
export const isUniqueViolation = (error: unknown, constraint: string) => {
  if (!(error instanceof DrizzleQueryError)) return false
  if (!(error.cause instanceof SQL.PostgresError)) return false
  return error.cause.errno === '23505' && error.cause.constraint === constraint
}

// Whether a query failed on the given check constraint.
export const isCheckViolation = (error: unknown, constraint: string) => {
  if (!(error instanceof DrizzleQueryError)) return false
  if (!(error.cause instanceof SQL.PostgresError)) return false
  return error.cause.errno === '23514' && error.cause.constraint === constraint
}
