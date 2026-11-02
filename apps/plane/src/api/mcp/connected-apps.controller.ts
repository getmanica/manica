import { Elysia, t } from 'elysia'
import { authMacro } from '../auth/session'
import { env } from '../platform/env'
import { CrossOriginRequestError } from './errors'
import { mcpGrantsService } from './grants.service'

// For the console: the consent page connecting an MCP client to one of the
// user's organizations, and the profile's list of connected apps. The user
// acts for themselves, whichever organization is active.

const clientId = t.String({ minLength: 1, maxLength: 2048 })

// Changes must come from the console's own pages: the session cookie alone
// would let another site on the same site (a sibling subdomain) post forms
// with it.
const consoleOrigin = new URL(env.betterAuthUrl).origin
const fromConsole = ({ request }: { request: Request }) => {
  if (request.headers.get('origin') !== consoleOrigin) {
    return new CrossOriginRequestError()
  }
}

export const connectedAppsController = new Elysia({
  prefix: '/connected-apps',
})
  .use(authMacro)
  .get('/', { auth: true }, ({ user }) => mcpGrantsService.connected(user.id))
  // The client asking for consent. Client ids may be URLs, so they're passed
  // in the query, not the path.
  .get('/client', { auth: true, query: t.Object({ clientId }) }, ({ query }) =>
    mcpGrantsService.client(query.clientId),
  )
  // Allows or denies the client, connecting it to the organization picked.
  .post(
    '/consent',
    {
      auth: true,
      beforeHandle: fromConsole,
      body: t.Object({
        // The consent page's query, as better-auth signed it.
        oauthQuery: t.String({ minLength: 1, maxLength: 8192 }),
        accept: t.Boolean(),
        // The scopes accepted, space-separated; all requested if unset.
        scope: t.Optional(t.String({ maxLength: 1024 })),
        organizationId: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
      }),
    },
    ({ user, body, request: { headers } }) =>
      mcpGrantsService.consent({ ...body, userId: user.id, headers }),
  )
  .delete(
    '/',
    { auth: true, beforeHandle: fromConsole, query: t.Object({ clientId }) },
    async ({ user, query, status }) => {
      const error = await mcpGrantsService.revoke(user.id, query.clientId)
      return error ?? status(204)
    },
  )
