import { Elysia } from 'elysia'
import { auth } from './auth'

const authMacro = new Elysia({ name: 'auth' }).macro({
  auth: {
    derive: async ({ status, request: { headers } }) => {
      const session = await auth.api.getSession({ headers })
      if (!session) return status(401)
      return { user: session.user, session: session.session }
    },
  },
})

const api = new Elysia({ prefix: '/api' })
  .use(authMacro)
  .get('/health', () => ({ status: 'ok' }))
  .get('/me', { auth: true }, ({ user }) => user)

// better-auth is mounted on the unprefixed root so it sees the full
// `/api/auth/*` path: mounting inside the `/api` instance strips the prefix,
// which breaks better-auth routing and the callback URLs it generates.
export const app = new Elysia().mount(auth.handler).use(api)

export type App = typeof app
