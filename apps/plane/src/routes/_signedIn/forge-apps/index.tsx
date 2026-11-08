import { forgeAppSorts } from '@shared/pagination'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'
import { ForgeApps } from '@/features/forge-apps/page'
import { paged, text } from '@/lib/search'

const search = z.object({
  ...paged(forgeAppSorts, 'createdAt'),
  q: text,
})

export const Route = createFileRoute('/_signedIn/forge-apps/')({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(search.parse({}))] },
  component: ForgeApps,
})
