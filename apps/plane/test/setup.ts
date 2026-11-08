// Run before each test file, before it reads the environment: points the
// plane at the database `test/global-setup.ts` made.
import { inject } from 'vitest'

process.env.DATABASE_URL = inject('databaseUrl')
// Placeholders for what the environment requires but tests don't use.
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET ||= 'test'
process.env.ENCRYPTION_KEY ||= Buffer.alloc(32).toString('base64')
