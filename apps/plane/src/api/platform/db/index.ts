import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'
import { relations } from './relations'

// One client per process: in development, Vite re-evaluates this module on
// edits, which would otherwise open a new pool each time.
const globals = globalThis as { planeDbClient?: postgres.Sql }
globals.planeDbClient ??= postgres(env.databaseUrl, { onnotice: () => {} })
const client = globals.planeDbClient

export const db = drizzle({ client, relations })

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
