import { Elysia } from 'elysia'
import { adminPlansController } from './admin/plans.controller'
import { adminUsersController } from './admin/users.controller'
import { agentsController } from './agents/agents.controller'
import { auth, signInMethods } from './auth/better-auth'
import { authMacro } from './auth/session'
import { billingController } from './billing/billing.controller'
import { forgeAppsController } from './forge-apps/forge-apps.controller'
import { forgeWebhooksController } from './forge-apps/webhooks.controller'
import { jobsController } from './jobs/jobs.controller'
import { connectedAppsController } from './mcp/connected-apps.controller'
import { mcpController } from './mcp/mcp.controller'
import { overviewController } from './overview/overview.controller'
import { agentController } from './runners/agent.controller'

// The API has four audiences, each authenticated its own way:
// - the console (the web app), with a better-auth session (`auth/session`);
// - agents, with the bearer token they were created with (`auth/agent-token`);
// - forges, delivering webhooks signed with the app's secret;
// - MCP clients, with an OAuth access token better-auth issued them
//   (`mcp/mcp.controller`), outside `/api` at `/mcp`.
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
  .use(connectedAppsController)
  .use(billingController)
  // Console, for the plane's admins
  .use(adminUsersController)
  .use(adminPlansController)
  // Agents
  .use(agentController)
  // Forges
  .use(forgeWebhooksController)

// better-auth is mounted on the unprefixed root so it sees the full
// `/api/auth/*` path: mounting inside the `/api` instance strips the prefix,
// which breaks better-auth routing and the callback URLs it generates.
export const app = new Elysia()
  .mount(auth.handler)
  .use(api)
  // MCP clients
  .use(mcpController)

export type App = typeof app
