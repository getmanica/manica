import { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { env } from '../env'
import { relations } from './relations'

const client = new SQL(env.databaseUrl)

export const db = drizzle({ client, relations })

export const runMigrations = () =>
  migrate(db, {
    migrationsFolder: new URL('../../drizzle', import.meta.url).pathname,
  })
