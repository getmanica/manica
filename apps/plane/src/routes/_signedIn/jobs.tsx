import { jobRanges } from '@shared/job-ranges'
import { jobSorts } from '@shared/pagination'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'
import { Jobs } from '@/features/jobs/page'
import { list, paged, text } from '@/lib/search'

const search = z.object({
  ...paged(jobSorts, 'queuedAt'),
  q: text,
  status: list,
  hide: list,
  range: z.enum(jobRanges).default('24h').catch('24h'),
})

export const Route = createFileRoute('/_signedIn/jobs')({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(search.parse({}))] },
  component: Jobs,
})
