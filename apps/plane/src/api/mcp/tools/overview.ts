import type { McpServer } from '@modelcontextprotocol/server'
import { t } from 'elysia'
import { overviewRanges } from '../../../shared/job-ranges'
import { overviewService } from '../../overview/overview.service'
import { runTool } from '../errors'
import { type ToolContext, toolInput } from './tool'

const getOverviewInput = toolInput(
  t.Object({
    range: t.Optional(
      t.UnionEnum(overviewRanges, {
        description:
          'The period to sum up, compared with the one before; 24h if unset',
      }),
    ),
    utcOffset: t.Optional(
      t.Integer({
        minimum: -14 * 60,
        maximum: 14 * 60,
        description:
          "Minutes ahead of UTC, so the chart's buckets line up with the user's clock; UTC if unset",
      }),
    ),
  }),
)

export const registerOverviewTools = (
  server: McpServer,
  context: ToolContext,
) => {
  server.registerTool(
    'get_overview',
    {
      title: 'Get overview',
      description:
        "The organization at a glance over a period: job counts, outcomes and wait times compared with the period before, jobs per time bucket, and each agent's status with the jobs it's running.",
      inputSchema: getOverviewInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ range = '24h', utcOffset }) =>
      runTool(() =>
        overviewService.get(context.principal.organizationId, range, {
          utcOffset,
        }),
      ),
  )
}
