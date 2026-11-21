import { Elysia, t } from 'elysia'
import { agentsService } from '../agents/agents.service'
import { agentAuthMacro } from '../auth/agent-token'
import { runnersService } from './index'

const bytes = t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })

// The agent API's request and response bodies, named: the agent (Rust)
// generates its types from them, through the OpenAPI spec the plane's tests
// keep in openapi/agent.json (see agent-api.test.ts).
export const agentModels = {
  AgentMetrics: t.Object({
    cpu: t.Number({ minimum: 0, maximum: 1 }),
    memoryUsed: bytes,
    memoryTotal: bytes,
    diskUsed: bytes,
    diskTotal: bytes,
  }),
  AgentPoll: t.Object({
    // Optional for agents that predate reporting it.
    version: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
    accepting: t.Boolean(),
    runners: t.Array(t.String(), { maxItems: 256 }),
    // Sent only by agents with metrics enabled, every so often.
    metrics: t.Optional(t.Ref('AgentMetrics')),
  }),
  // A runner for the agent to start, with its JIT config.
  RunnerStart: t.Object({
    id: t.String(),
    name: t.String(),
    config: t.String(),
  }),
  // The actions/runner build to start runners with.
  RunnerBuild: t.Object({
    version: t.String(),
    url: t.String(),
    sha256: t.String(),
  }),
  AgentPollResult: t.Object({
    start: t.Array(t.Ref('RunnerStart')),
    // Runners the agent should stop: the plane has given up on them.
    cancel: t.Array(t.String()),
    leaseSeconds: t.Integer({ minimum: 0 }),
    runner: t.Nullable(t.Ref('RunnerBuild')),
  }),
  RunnerExited: t.Object({ exitCode: t.Nullable(t.Integer()) }),
}

// The API agents call, as opposed to `/agents`, used to manage them.
export const agentController = new Elysia({ prefix: '/agent' })
  .use(agentAuthMacro)
  .model(agentModels)
  // Superseded by `/poll`, kept for agents that predate it, and for
  // `manica-agent doctor`, which checks the token without polling.
  .post('/heartbeat', { agent: true }, ({ agent }) =>
    agentsService.heartbeat(agent.id),
  )
  .post(
    '/poll',
    {
      agent: true,
      body: 'AgentPoll',
      response: { 200: 'AgentPollResult' },
    },
    ({ agent, body }) => runnersService.poll(agent.id, body),
  )
  .post(
    '/runners/:id/exited',
    {
      agent: true,
      body: 'RunnerExited',
      response: { 204: t.Void() },
    },
    async ({ agent, params: { id }, body, status }) => {
      await runnersService.exited(agent.id, id, body.exitCode)
      return status(204, undefined)
    },
  )
