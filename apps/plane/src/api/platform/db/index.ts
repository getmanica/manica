import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { env } from '../env'
import { relations } from './relations'

export const db = drizzle({ client: new SQL(env.databaseUrl), relations })

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const runMigrations = () =>
  migrate(db, { migrationsFolder: env.migrationsDir })
