import type { McpServer } from '@modelcontextprotocol/server'
import { t } from 'elysia'
import { agentSorts } from '../../../shared/pagination'
import { platformKeys } from '../../../shared/platform'
import { agentsService } from '../../agents/agents.service'
import { agentFields, manageAgents } from '../../agents/schema'
import { listQuery } from '../../platform/pagination'
import { NoChangesError, runTool } from '../errors'
import { cursorField, resolveQuery, withCursor } from '../pagination'
import { authorizeWrite, type ToolContext, toolInput } from './tool'

const { name, os, arch, slots, labels } = agentFields
const id = t.String({ minLength: 1, maxLength: 64 })

const listAgentsInput = toolInput(
  t.Object({
    ...listQuery(agentSorts),
    platform: t.Optional(
      t.Array(t.UnionEnum(platformKeys), {
        description: 'Platforms to keep; all if unset',
      }),
    ),
    ...cursorField,
  }),
)

const createAgentInput = toolInput(
  t.Object({
    name,
    os,
    arch,
    slots: t.Optional(slots),
    labels: t.Optional(labels),
  }),
)

const updateAgentInput = toolInput(
  t.Object({
    id,
    name: t.Optional(name),
    os: t.Optional(os),
    arch: t.Optional(arch),
    slots: t.Optional(slots),
    labels: t.Optional(labels),
  }),
)

const deleteAgentInput = toolInput(t.Object({ id }))

// Regenerating an agent's token isn't offered: it would hand the new token
// to the client, and stop the agent until someone installs it.
export const registerAgentTools = (server: McpServer, context: ToolContext) => {
  const { organizationId, userId } = context.principal

  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description:
        "A page of the organization's agents (the machines that run jobs), newest first unless sorted otherwise, each with how many of its slots are running jobs. Filter by platform and text (`q`: name, platform, version or labels).",
      inputSchema: listAgentsInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const query = await resolveQuery(listAgentsInput, args)
        const { platform, ...options } = query
        const result = await agentsService.list(organizationId, {
          ...options,
          platforms: platform,
        })
        return withCursor(query, result)
      }),
  )

  server.registerTool(
    'create_agent',
    {
      title: 'Create agent',
      description:
        "Registers an agent: a machine that runs the organization's jobs on its platform, up to `slots` at once, picking jobs by its labels. Returns the agent and its token, which the agent authenticates with: this is the only time the token is shown, so pass it on to the user to install the agent with.",
      inputSchema: createAgentInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) =>
      runTool(async () => {
        await authorizeWrite(context, manageAgents)
        return agentsService.create({
          ...args,
          name: args.name.trim(),
          organizationId,
          userId,
        })
      }),
  )

  server.registerTool(
    'update_agent',
    {
      title: 'Update agent',
      description:
        'Changes an agent’s name, platform, slots or labels. Fields left out stay as they are; labels are replaced as a whole.',
      inputSchema: updateAgentInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id, ...changes }) =>
      runTool(async () => {
        await authorizeWrite(context, manageAgents)
        if (Object.values(changes).every((value) => value === undefined)) {
          return new NoChangesError()
        }
        return agentsService.update(organizationId, id, {
          ...changes,
          name: changes.name?.trim(),
        })
      }),
  )

  server.registerTool(
    'delete_agent',
    {
      title: 'Delete agent',
      description:
        'Deletes an agent for good: its token stops working. Refused while the agent is running jobs.',
      inputSchema: deleteAgentInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ id }) =>
      runTool(async () => {
        await authorizeWrite(context, manageAgents)
        const error = await agentsService.delete(organizationId, id)
        return error ?? { deleted: id }
      }),
  )
}
