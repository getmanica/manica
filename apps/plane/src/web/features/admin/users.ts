import type { Treaty } from '@elysia/eden'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export type UserList = Treaty.Data<(typeof api)['admin']['users']['get']>
export type AdminUser = UserList['items'][number]
export type UserListQuery = NonNullable<
  Parameters<(typeof api)['admin']['users']['get']>[0]
>['query']

export const usersKey = ['admin', 'users']

// A page of the plane's users. Another page, sort or filter keeps showing
// the previous one's users until its own arrive.
export const usersQuery = (query: UserListQuery) =>
  queryOptions({
    queryKey: [...usersKey, query],
    queryFn: ({ signal }) =>
      api.admin.users.get({ query, fetch: { signal } }).then(unwrap),
    placeholderData: (previous) => previous,
  })
