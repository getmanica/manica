import { McpServer } from '@modelcontextprotocol/server'
import { version } from '../../../package.json'
import { registerAgentTools } from './tools/agents'
import { registerForgeAppTools } from './tools/forge-apps'
import { registerJobTools } from './tools/jobs'
import { registerOverviewTools } from './tools/overview'
import type { ToolContext } from './tools/tool'

// The tools that change things: calling one takes the `plane:write` scope,
// checked before the call reaches the server so a read-only client is
// challenged to step up (see `mcp.controller.ts`).
export const writeTools: ReadonlySet<string> = new Set([
  'create_agent',
  'update_agent',
  'delete_agent',
])

// The MCP server for one request, acting as `context`'s principal. Every
// tool is listed whatever the token's scopes: calling a write tool without
// `plane:write` is what asks for it.
export const createMcpServer = (context: ToolContext) => {
  const server = new McpServer(
    { name: 'manica-plane', title: 'Manica', version },
    {
      instructions:
        "Manica runs an organization's CI jobs on its own machines (agents), receiving jobs from forge apps such as GitHub Apps. These tools read the organization's jobs, agents and forge apps, and manage its agents. Lists are paged: pass a result's `nextCursor` as `cursor` for the next page.",
    },
  )
  registerOverviewTools(server, context)
  registerJobTools(server, context)
  registerAgentTools(server, context)
  registerForgeAppTools(server, context)
  return server
}
