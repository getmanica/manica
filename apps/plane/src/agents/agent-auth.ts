import { Elysia } from 'elysia'
import { agentsService } from './agents.service'

const BEARER = 'Bearer '

// Authenticates requests made by an agent, from the token it was given when
// created, sent as `Authorization: Bearer <token>`.
export const agentAuthMacro = new Elysia({ name: 'agent-auth' }).macro({
  agent: {
    derive: async ({ status, request: { headers } }) => {
      const authorization = headers.get('authorization')
      if (!authorization?.startsWith(BEARER)) return status(401)
      const agent = await agentsService.authenticate(
        authorization.slice(BEARER.length),
      )
      if (!agent) return status(401)
      return { agent }
    },
  },
})
