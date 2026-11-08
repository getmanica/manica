import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // .env, as the dev server reads it (DATABASE_URL names the Postgres the
  // global setup makes the test database on); what the environment already
  // sets wins. Test files inherit it.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value
  }
  return {
    resolve: { tsconfigPaths: true },
    test: {
      globalSetup: ['./test/global-setup.ts'],
      setupFiles: ['./test/setup.ts'],
      // One file at a time: they share a database, and some (the scheduler's
      // locks, plan limits across organizations) act on all of it.
      fileParallelism: false,
    },
  }
})
