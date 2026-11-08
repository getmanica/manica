import { agentSorts } from '@shared/pagination'
import { platformKeys } from '@shared/platform'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'
import { Agents } from '@/features/agents/page'
import { list, paged, text } from '@/lib/search'

const search = z.object({
  ...paged(agentSorts, 'createdAt'),
  q: text,
  platform: z.array(z.enum(platformKeys)).default([]).catch([]),
  hide: list,
})

export const Route = createFileRoute('/_signedIn/agents')({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(search.parse({}))] },
  component: Agents,
})
