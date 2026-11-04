import type { Treaty } from '@elysia/eden'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export type PlanList = Treaty.Data<(typeof api)['admin']['plans']['get']>
export type AdminPlan = PlanList['items'][number]

export const plansKey = ['admin', 'plans']

// Every plan, and whether billing is on to use them.
export const plansQuery = queryOptions({
  queryKey: plansKey,
  queryFn: ({ signal }) =>
    api.admin.plans.get({ fetch: { signal } }).then(unwrap),
})
