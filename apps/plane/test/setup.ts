// Preloaded by `bun test` (see bunfig.toml), before any test reads the
// environment: points the plane at a fresh, migrated database, dropped after
// the run. DATABASE_URL (from .env) names the Postgres to create it on, the
// one from the root compose.yaml. Tests share it, each scoping its data to
// an organization of its own.
import { afterAll } from 'bun:test'
import { SQL } from 'bun'

const url = Bun.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required to run tests against Postgres')
}

const name = `manica_test_${crypto.randomUUID().replaceAll('-', '')}`
const admin = new SQL(url)
await admin.unsafe(`create database "${name}"`)

const testUrl = new URL(url)
testUrl.pathname = `/${name}`
Bun.env.DATABASE_URL = testUrl.toString()
// Placeholders for what the environment requires but tests don't use.
Bun.env.BETTER_AUTH_URL ||= 'http://localhost:3000'
Bun.env.BETTER_AUTH_SECRET ||= 'test'
Bun.env.ENCRYPTION_KEY ||= Buffer.alloc(32).toString('base64')

const { db, runMigrations } = await import('../src/api/platform/db')
await runMigrations()

afterAll(async () => {
  await db.$client.close()
  await admin.unsafe(`drop database "${name}" with (force)`)
  await admin.close()
})
