import { Elysia, t } from 'elysia'
import { overviewRanges } from '../../shared/job-ranges'
import { authMacro } from '../auth/session'
import { overviewService } from './overview.service'

export const overviewController = new Elysia({ prefix: '/overview' })
  .use(authMacro)
  .get(
    '/',
    {
      organization: true,
      query: t.Object({
        range: t.Optional(t.UnionEnum(overviewRanges)),
        // The viewer's clock, in minutes ahead of UTC, so the chart's bars
        // line up with it.
        utcOffset: t.Optional(
          t.Integer({ minimum: -14 * 60, maximum: 14 * 60 }),
        ),
      }),
    },
    ({ organizationId, query: { range = '24h', utcOffset } }) =>
      overviewService.get(organizationId, range, { utcOffset }),
  )
