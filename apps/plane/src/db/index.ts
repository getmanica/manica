import { PGlite } from '@electric-sql/pglite'
import { SQL } from 'bun'
import { drizzle as drizzleBunSql } from 'drizzle-orm/bun-sql'
import { migrate as migrateBunSql } from 'drizzle-orm/bun-sql/migrator'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { env } from '../env'
import { relations } from './relations'

const migrationsFolder = new URL('../../drizzle', import.meta.url).pathname
const pgliteDataDir = new URL('../../.pglite', import.meta.url).pathname

const connect = () => {
  if (env.databaseUrl) {
    const db = drizzleBunSql({ client: new SQL(env.databaseUrl), relations })
    return { db, runMigrations: () => migrateBunSql(db, { migrationsFolder }) }
  }

  console.log(`using embedded PGlite database at ${pgliteDataDir}`)
  const db = drizzlePglite({ client: new PGlite(pgliteDataDir), relations })
  return { db, runMigrations: () => migratePglite(db, { migrationsFolder }) }
}

export const { db, runMigrations } = connect()
