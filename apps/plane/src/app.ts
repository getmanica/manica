import { Elysia } from 'elysia'
import { agentsController } from './agents/agents.controller'
import { auth, authMacro } from './auth'
import { forgeAppsController } from './forges/apps.controller'
import { forgeWebhooksController } from './forges/webhooks.controller'

const api = new Elysia({ prefix: '/api' })
  .use(authMacro)
  .get('/health', () => ({ status: 'ok' }))
  .get('/me', { auth: true }, ({ user }) => user)
  .use(agentsController)
  .use(forgeAppsController)
  .use(forgeWebhooksController)

// better-auth is mounted on the unprefixed root so it sees the full
// `/api/auth/*` path: mounting inside the `/api` instance strips the prefix,
// which breaks better-auth routing and the callback URLs it generates.
export const app = new Elysia().mount(auth.handler).use(api)

export type App = typeof app
