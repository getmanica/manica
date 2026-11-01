import type { Treaty } from '@elysia/eden'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

export type ForgeApp = Treaty.Data<(typeof api)['forge-apps']['get']>[number]

// The active organization's forge apps.
export const forgeAppsQuery = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: ['forge-apps', organizationId],
    queryFn: ({ signal }) =>
      api['forge-apps'].get({ fetch: { signal } }).then(unwrap),
    enabled: organizationId !== undefined,
  })

type SetupRedirect = Treaty.Data<
  (typeof api)['forge-apps']['setup']['post']
>['redirect']

export const forgeLabels: Record<ForgeApp['forge'], string> = {
  github: 'GitHub',
}

// Sends the browser to the forge to register the app. Forges that take the
// app definition as a form post (GitHub's manifest) can't be reached by a
// plain navigation.
export const followSetupRedirect = ({ url, method, fields }: SetupRedirect) => {
  if (method === 'GET') {
    const target = new URL(url)
    for (const [name, value] of Object.entries(fields)) {
      target.searchParams.set(name, value)
    }
    window.location.assign(target)
    return
  }

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = url
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  form.submit()
}
