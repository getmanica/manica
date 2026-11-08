import { isAdmin } from '@shared/admin'
import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { useCallback, useEffect, useRef } from 'react'
import { authClient } from '@/lib/auth'

// The viewer's session, read on the server from the request's cookies: the
// root route loads it before any page renders, so pages and their guards
// have it while rendering on the server too.
const fetchSession = createServerFn().handler(async () => {
  const { auth } = await import('../../api/auth/better-auth')
  return auth.api.getSession({ headers: getRequestHeaders() })
})

export type Session = NonNullable<Awaited<ReturnType<typeof fetchSession>>>

// Fetched once, then kept until something changes it (see below).
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: () => fetchSession(),
  staleTime: Number.POSITIVE_INFINITY,
})

// Reads the session again, running the routes' guards with it.
const useRefreshSession = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
    await router.invalidate()
  }, [queryClient, router])
}

export const useSession = () => {
  const { session } = useRouteContext({ from: '__root__' })
  return { data: session, refetch: useRefreshSession() }
}

// What a change of session is: another session, gaining or losing the admin
// role, or the user's details changing.
const sessionKey = (
  session:
    | {
        session: { id: string }
        user: { role?: string | null; updatedAt: Date | string }
      }
    | null
    | undefined,
) =>
  session
    ? [
        session.session.id,
        isAdmin(session.user.role),
        new Date(session.user.updatedAt).getTime(),
      ].join(':')
    : ''

// Follows better-auth's client, which learns of signing in and out (and
// refetches when the window regains focus): when its session changes, the
// cache goes if the user did, and the session is read again, which moves
// the viewer to the overview or to signing in.
export const SessionWatcher = () => {
  const { data, isPending } = authClient.useSession()
  const queryClient = useQueryClient()
  const refresh = useRefreshSession()
  // What the page was rendered with: the client's first answer can already
  // differ (signed in or out, renamed, demoted since).
  const { session: rendered } = useRouteContext({ from: '__root__' })
  const seen = useRef({ key: sessionKey(rendered), userId: rendered?.user.id })

  useEffect(() => {
    if (isPending) return
    const now = { key: sessionKey(data), userId: data?.user.id }
    const before = seen.current
    seen.current = now
    if (before.key === now.key) return
    if (before.userId !== now.userId) queryClient.clear()
    void refresh()
  }, [data, isPending, queryClient, refresh])

  return null
}
