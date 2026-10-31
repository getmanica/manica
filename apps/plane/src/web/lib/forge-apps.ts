import type { Treaty } from '@elysia/eden'
import type { api } from '@/lib/api'

export type ForgeApp = Treaty.Data<(typeof api)['forge-apps']['get']>[number]

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
