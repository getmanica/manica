import { Elysia, t } from 'elysia'
import { jobRangeStart, jobRanges } from '../../shared/job-ranges'
import { authMacro } from '../auth/session'
import { jobsService } from './jobs.service'

export const jobsController = new Elysia({ prefix: '/jobs' })
  .use(authMacro)
  .get(
    '/',
    {
      organization: true,
      query: t.Object({ range: t.Optional(t.UnionEnum(jobRanges)) }),
    },
    ({ organizationId, query: { range } }) =>
      jobsService.list(organizationId, range && jobRangeStart(range)),
  )
