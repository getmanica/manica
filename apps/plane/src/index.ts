import { Elysia } from 'elysia'
import { auth } from './auth'
import { runMigrations } from './db'
import { env } from './env'

await runMigrations()

const authPlugin = new Elysia({ name: 'auth' }).mount(auth.handler).macro({
  auth: {
    derive: async ({ status, request: { headers } }) => {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401)
      return { user: session.user, session: session.session }
    },
  },
})

const app = new Elysia()
  .use(authPlugin)
  .get('/health', () => ({ status: 'ok' }))
  .get('/me', { auth: true }, ({ user }) => user)
  .listen(env.port)

console.log(`plane listening on ${app.server?.url}`)

export type App = typeof app
