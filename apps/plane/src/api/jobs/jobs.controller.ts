import { Elysia, t } from 'elysia'
import { jobRangeStart, jobRanges } from '../../shared/job-ranges'
import { jobSorts } from '../../shared/pagination'
import { authMacro } from '../auth/session'
import { listQuery } from '../platform/pagination'
import { jobsService } from './jobs.service'

export const jobsController = new Elysia({ prefix: '/jobs' })
  .use(authMacro)
  .get(
    '/',
    {
      organization: true,
      query: t.Object({
        ...listQuery(jobSorts),
        range: t.Optional(t.UnionEnum(jobRanges)),
        // Outcomes to keep (see `shared/job-outcomes`); none keeps all.
        status: t.Optional(t.Array(t.String({ maxLength: 64 }))),
      }),
    },
    ({ organizationId, query: { range, status, ...options } }) =>
      jobsService.list(organizationId, {
        ...options,
        since: range && jobRangeStart(range),
        outcomes: status,
      }),
  )
