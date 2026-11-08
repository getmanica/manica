import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// The plane never migrates on its own: migrations run as their own step
// (`src/migrate.ts`), and the server refuses to start while any are pending
// (`./pending`). Imports only packages, so Node runs it as is.

// Applies the migrations in `folder` (the repo's drizzle/) that `url`'s
// database lacks.
export const migrateDatabase = async (url: string, folder: string) => {
  const client = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle({ client }), { migrationsFolder: folder })
  } finally {
    await client.end()
  }
}
