import { overviewRanges } from '@shared/job-ranges'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'
import { Overview } from '@/features/overview/page'

const search = z.object({
  range: z.enum(overviewRanges).default('24h').catch('24h'),
})

export const Route = createFileRoute('/_signedIn/')({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(search.parse({}))] },
  component: Overview,
})
