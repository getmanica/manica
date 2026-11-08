// Applies pending migrations, as its own step: `bun run db:migrate`, or
// `node dist/migrate.js` in the image (a pre-deploy step). drizzle/ is
// `../drizzle` from here and from dist/, where this is bundled.
import { fileURLToPath } from 'node:url'
import { migrateDatabase } from './api/platform/db/migrations.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('Missing environment variable: DATABASE_URL')

await migrateDatabase(
  url,
  process.env.MIGRATIONS_DIR ||
    fileURLToPath(new URL('../drizzle', import.meta.url)),
)
console.log('migrations applied')
