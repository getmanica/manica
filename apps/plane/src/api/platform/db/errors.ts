import { DrizzleQueryError } from 'drizzle-orm'
import postgres from 'postgres'

// Whether a query failed with the given SQLSTATE on the given constraint.
const isViolation = (error: unknown, code: string, constraint: string) =>
  error instanceof DrizzleQueryError &&
  error.cause instanceof postgres.PostgresError &&
  error.cause.code === code &&
  error.cause.constraint_name === constraint

// Whether a query failed on the given unique constraint.
export const isUniqueViolation = (error: unknown, constraint: string) =>
  isViolation(error, '23505', constraint)

// Whether a query failed on the given check constraint.
export const isCheckViolation = (error: unknown, constraint: string) =>
  isViolation(error, '23514', constraint)
