import type { McpServer } from '@modelcontextprotocol/server'
import { t } from 'elysia'
import { forgeAppSorts } from '../../../shared/pagination'
import { forgeAppsService } from '../../forge-apps/forge-apps.service'
import { listQuery } from '../../platform/pagination'
import { runTool } from '../errors'
import { cursorField, resolveQuery, withCursor } from '../pagination'
import { type ToolContext, toolInput } from './tool'

const listForgeAppsInput = toolInput(
  t.Object({ ...listQuery(forgeAppSorts), ...cursorField }),
)

const getForgeAppInput = toolInput(
  t.Object({ id: t.String({ minLength: 1, maxLength: 64 }) }),
)

// Setting a forge app up isn't offered: it takes the user's browser, to
// register the app on the forge.
export const registerForgeAppTools = (
  server: McpServer,
  context: ToolContext,
) => {
  const { organizationId } = context.principal

  server.registerTool(
    'list_forge_apps',
    {
      title: 'List forge apps',
      description:
        "A page of the organization's forge apps (e.g. GitHub Apps), through which plane receives jobs, newest first unless sorted otherwise. Filter by text (`q`: name, slug, account or forge).",
      inputSchema: listForgeAppsInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const query = await resolveQuery(listForgeAppsInput, args)
        const result = await forgeAppsService.list(organizationId, query)
        return withCursor(query, result)
      }),
  )

  server.registerTool(
    'get_forge_app',
    {
      title: 'Get forge app',
      description: 'One of the organization’s forge apps, by id.',
      inputSchema: getForgeAppInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) => runTool(() => forgeAppsService.get(organizationId, id)),
  )
}
