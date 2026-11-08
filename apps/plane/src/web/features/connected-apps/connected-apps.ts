import type { Treaty } from '@elysia/eden'
import { queryOptions } from '@tanstack/react-query'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { api } from '@/lib/api'
import { unwrap } from '@/lib/query'

// MCP clients (e.g. Claude Code, Cursor) the user connected to an
// organization, through OAuth.

export type ConnectedApp = Treaty.Data<
  (typeof api)['connected-apps']['get']
>[number]

export const connectedAppsQuery = queryOptions({
  queryKey: ['connected-apps'],
  queryFn: ({ signal }) =>
    api['connected-apps'].get({ fetch: { signal } }).then(unwrap),
})

// The client asking for the user's consent.
export const consentClientQuery = (clientId: string) =>
  queryOptions({
    queryKey: ['connected-apps', 'client', clientId],
    queryFn: ({ signal }) =>
      api['connected-apps'].client
        .get({ query: { clientId }, fetch: { signal } })
        .then(unwrap),
    retry: false,
  })

// The authorization request a client sent the user here with, as
// better-auth signed it (sign-in and consent hand it back), or none, also
// once it expired. From the URL being rendered on the server; in the
// browser, captured as the page loads, before anything can rewrite the URL.
const signedRequest = (search: string) => {
  const signed = new URLSearchParams(search)
  return signed.has('sig') && Number(signed.get('exp')) * 1000 > Date.now()
    ? search.replace(/^\?/, '')
    : undefined
}
const loadedWith =
  typeof window === 'undefined'
    ? undefined
    : signedRequest(window.location.search)
export const pendingAuthorization = createIsomorphicFn()
  .server(() => signedRequest(getRequestUrl().search))
  .client(() => loadedWith)

// What each scope lets a client do, as the consent page and the profile
// say it. `required` scopes can't be left out: every token must read.
export const scopeDescriptions: Record<
  string,
  { label: string; detail: string; required?: boolean }
> = {
  'plane:read': {
    label: 'See the organization',
    detail: 'Jobs, agents, forge apps, and the overview.',
    required: true,
  },
  'plane:write': {
    label: 'Manage agents',
    detail:
      'Create, change and delete agents, if your role allows it. Creating one shows its token to the app.',
  },
  offline_access: {
    label: 'Stay connected',
    detail: 'Keep access without asking again, until you disconnect it.',
    required: true,
  },
  openid: {
    label: 'Know who you are',
    detail: 'Your account’s id.',
    required: true,
  },
  profile: {
    label: 'See your profile',
    detail: 'Your name and picture.',
    required: true,
  },
}

// A client id that's an HTTPS URL is a metadata document plane fetched:
// its host vouches for the app. Other clients registered themselves.
export const verifiedHost = (clientId: string) => {
  try {
    const url = new URL(clientId)
    return url.protocol === 'https:' ? url.host : undefined
  } catch {
    return undefined
  }
}
