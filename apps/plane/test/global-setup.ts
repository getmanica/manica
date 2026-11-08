// Vitest's global setup, run once before every test file: creates a fresh,
// migrated database on DATABASE_URL's Postgres (from .env, the root
// compose.yaml's), handed to the tests through `test/setup.ts` and dropped
// after the run. Tests share it, each scoping its data to an organization of
// its own.
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'
import { migrateDatabase } from '../src/api/platform/db/migrations'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

export default async ({ provide }: TestProject) => {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is required to run tests against Postgres')
  }

  const name = `manica_test_${crypto.randomUUID().replaceAll('-', '')}`
  const admin = postgres(url, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database "${name}"`)

  const drop = async () => {
    await admin.unsafe(`drop database "${name}" with (force)`)
    await admin.end()
  }

  const testUrl = new URL(url)
  testUrl.pathname = `/${name}`
  try {
    await migrateDatabase(
      testUrl.toString(),
      fileURLToPath(new URL('../drizzle', import.meta.url)),
    )
  } catch (error) {
    // No teardown runs for a setup that throws.
    await drop()
    throw error
  }
  provide('databaseUrl', testUrl.toString())

  return drop
}
