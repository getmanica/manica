import { Elysia, t } from 'elysia'
import { agentsService } from '../agents/agents.service'
import { agentAuthMacro } from '../auth/agent-token'
import { runnersService } from './index'

// The API agents call, as opposed to `/agents`, used to manage them.
export const agentController = new Elysia({ prefix: '/agent' })
  .use(agentAuthMacro)
  // Superseded by `/poll`, kept for agents that predate it.
  .post('/heartbeat', { agent: true }, ({ agent }) =>
    agentsService.heartbeat(agent.id),
  )
  .post(
    '/poll',
    {
      agent: true,
      body: t.Object({
        // Optional for agents that predate reporting it.
        version: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
        accepting: t.Boolean(),
        runners: t.Array(t.String(), { maxItems: 256 }),
      }),
    },
    ({ agent, body }) => runnersService.poll(agent.id, body),
  )
  .post(
    '/runners/:id/exited',
    {
      agent: true,
      body: t.Object({ exitCode: t.Nullable(t.Integer()) }),
    },
    async ({ agent, params: { id }, body, status }) => {
      await runnersService.exited(agent.id, id, body.exitCode)
      return status(204)
    },
  )
