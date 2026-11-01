import { Elysia } from 'elysia'
import { agentsController } from './agents/agents.controller'
import { auth, signInMethods } from './auth/better-auth'
import { authMacro } from './auth/session'
import { forgeAppsController } from './forge-apps/forge-apps.controller'
import { forgeWebhooksController } from './forge-apps/webhooks.controller'
import { jobsController } from './jobs/jobs.controller'
import { overviewController } from './overview/overview.controller'
import { agentController } from './runners/agent.controller'

// The API has three audiences, each authenticated its own way:
// - the console (the web app), with a better-auth session (`auth/session`);
// - agents, with the bearer token they were created with (`auth/agent-token`);
// - forges, delivering webhooks signed with the app's secret.
const api = new Elysia({ prefix: '/api' })
  .use(authMacro)
  .get('/health', () => ({ status: 'ok' }))
  .get('/sign-in-methods', signInMethods)
  // Console
  .get('/me', { auth: true }, ({ user }) => user)
  .use(agentsController)
  .use(forgeAppsController)
  .use(jobsController)
  .use(overviewController)
  // Agents
  .use(agentController)
  // Forges
  .use(forgeWebhooksController)

// better-auth is mounted on the unprefixed root so it sees the full
// `/api/auth/*` path: mounting inside the `/api` instance strips the prefix,
// which breaks better-auth routing and the callback URLs it generates.
export const app = new Elysia().mount(auth.handler).use(api)

export type App = typeof app
