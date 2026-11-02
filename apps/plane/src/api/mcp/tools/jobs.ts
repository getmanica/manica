import type { McpServer } from '@modelcontextprotocol/server'
import { t } from 'elysia'
import { commonOutcomes } from '../../../shared/job-outcomes'
import { jobRangeStart, jobRanges } from '../../../shared/job-ranges'
import { jobSorts } from '../../../shared/pagination'
import { jobsService } from '../../jobs/jobs.service'
import { listQuery } from '../../platform/pagination'
import { runTool } from '../errors'
import { cursorField, resolveQuery, withCursor } from '../pagination'
import { type ToolContext, toolInput } from './tool'

const listJobsInput = toolInput(
  t.Object({
    ...listQuery(jobSorts),
    range: t.Optional(
      t.UnionEnum(jobRanges, {
        description: 'How far back to look, by queue time; all time if unset',
      }),
    ),
    status: t.Optional(
      t.Array(t.String({ maxLength: 64 }), {
        description: `Outcomes to keep, e.g. ${commonOutcomes.join(', ')}; all if unset`,
      }),
    ),
    ...cursorField,
  }),
)

export const registerJobTools = (server: McpServer, context: ToolContext) => {
  server.registerTool(
    'list_jobs',
    {
      title: 'List jobs',
      description:
        "A page of the organization's CI jobs, latest first unless sorted otherwise, with how many match in all and the outcomes present. Filter by queue time (`range`), outcome (`status`) and text (`q`: name, repository, agent, outcome or labels).",
      inputSchema: listJobsInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      runTool(async () => {
        const query = await resolveQuery(listJobsInput, args)
        const { range, status, ...options } = query
        const result = await jobsService.list(
          context.principal.organizationId,
          {
            ...options,
            since: range && jobRangeStart(range),
            outcomes: status,
          },
        )
        return withCursor(query, result)
      }),
  )
}
