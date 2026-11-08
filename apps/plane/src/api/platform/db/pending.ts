import type postgres from 'postgres'

// The migrations this build knows of, by folder name, as the migrator
// records them. Inlined (as text, the only way to glob them; about 25 kB),
// so the server needs no drizzle/ of its own.
const known = Object.keys(
  import.meta.glob('../../../../drizzle/*/migration.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).map((path) => path.split('/').at(-2) as string)

export class PendingMigrationsError extends Error {
  override readonly name = 'PendingMigrationsError'

  constructor(readonly pending: string[]) {
    super(
      `${pending.length} pending migration(s): ${pending.join(', ')}. Run them first: \`bun run db:migrate\`, or \`node dist/migrate.js\` in the image`,
    )
  }
}

// Throws unless every migration this build knows of has been applied.
export const assertMigrated = async (client: postgres.Sql) => {
  const [table] = await client<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists`
  const applied = new Set(
    table?.exists
      ? (
          await client<{ name: string | null }[]>`
            select name from drizzle.__drizzle_migrations`
        ).map((row) => row.name)
      : [],
  )
  const pending = known.filter((name) => !applied.has(name))
  if (pending.length > 0) throw new PendingMigrationsError(pending)
}
