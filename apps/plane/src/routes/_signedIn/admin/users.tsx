import { userSorts } from '@shared/pagination'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { z } from 'zod'
import { AdminUsers } from '@/features/admin/page'
import { paged, text } from '@/lib/search'

const search = z.object({
  ...paged(userSorts, 'createdAt'),
  q: text,
})

export const Route = createFileRoute('/_signedIn/admin/users')({
  validateSearch: search,
  search: { middlewares: [stripSearchParams(search.parse({}))] },
  component: AdminUsers,
})
