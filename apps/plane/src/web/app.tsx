import { jobRanges, overviewRanges } from '@shared/job-ranges'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
  redirect,
  stripSearchParams,
} from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
import { AppLayout } from '@/components/layout'
import { Agents } from '@/features/agents/page'
import { SignIn } from '@/features/auth/sign-in'
import { SignUp } from '@/features/auth/sign-up'
import { ForgeApps } from '@/features/forge-apps/page'
import {
  ForgeAppSetupError,
  ForgeAppSetupSuccess,
} from '@/features/forge-apps/setup'
import { Jobs } from '@/features/jobs/page'
import { Overview } from '@/features/overview/page'
import { Profile } from '@/features/profile/page'
import { authClient } from '@/lib/auth'

type Session = typeof authClient.$Infer.Session

// Page state kept in the URL, so a reload or a shared link shows the same
// view. Invalid values fall back to the default, and values equal to their
// default are left out of the URL.
const text = z.string().default('').catch('')
const list = z.array(z.string()).default([]).catch([])
const optional = z.string().optional().catch(undefined)

const overviewSearch = z.object({
  range: z.enum(overviewRanges).default('24h').catch('24h'),
})
const jobsSearch = z.object({
  q: text,
  status: list,
  hide: list,
  range: z.enum(jobRanges).default('24h').catch('24h'),
})
const agentsSearch = z.object({ q: text, platform: list, hide: list })
const forgeAppsSearch = z.object({ q: text })

const root = createRootRouteWithContext<{ session: Session | null }>()({
  component: Outlet,
})

// Signed in, the sign-in pages lead to the overview; signed out, every other
// page leads to signing in.

const signedOut = createRoute({
  getParentRoute: () => root,
  id: '_signedOut',
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: '/', replace: true })
  },
})

const signedIn = createRoute({
  getParentRoute: () => root,
  id: '_signedIn',
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login', replace: true })
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
})

const login = createRoute({
  getParentRoute: () => signedOut,
  path: 'login',
  // Set by better-auth when signing in with GitHub fails.
  validateSearch: z.object({ error: optional }),
  component: SignIn,
})

const signup = createRoute({
  getParentRoute: () => signedOut,
  path: 'signup',
  component: SignUp,
})

const overview = createRoute({
  getParentRoute: () => signedIn,
  path: '/',
  validateSearch: overviewSearch,
  search: { middlewares: [stripSearchParams(overviewSearch.parse({}))] },
  component: Overview,
})

const jobs = createRoute({
  getParentRoute: () => signedIn,
  path: 'jobs',
  validateSearch: jobsSearch,
  search: { middlewares: [stripSearchParams(jobsSearch.parse({}))] },
  component: Jobs,
})

const agents = createRoute({
  getParentRoute: () => signedIn,
  path: 'agents',
  validateSearch: agentsSearch,
  search: { middlewares: [stripSearchParams(agentsSearch.parse({}))] },
  component: Agents,
})

const forgeApps = createRoute({
  getParentRoute: () => signedIn,
  path: 'forge-apps',
  validateSearch: forgeAppsSearch,
  search: { middlewares: [stripSearchParams(forgeAppsSearch.parse({}))] },
  component: ForgeApps,
})

// Landing pages for `GET /api/forge-apps/setup/callback`.
const forgeAppSetupSuccess = createRoute({
  getParentRoute: () => signedIn,
  path: 'forge-apps/setup/success',
  validateSearch: z.object({ app: optional }),
  component: ForgeAppSetupSuccess,
})

const forgeAppSetupError = createRoute({
  getParentRoute: () => signedIn,
  path: 'forge-apps/setup/error',
  validateSearch: z.object({ code: optional }),
  component: ForgeAppSetupError,
})

const profile = createRoute({
  getParentRoute: () => signedIn,
  path: 'profile',
  component: Profile,
})

const routeTree = root.addChildren([
  signedOut.addChildren([login, signup]),
  signedIn.addChildren([
    overview,
    jobs,
    agents,
    forgeApps,
    forgeAppSetupSuccess,
    forgeAppSetupError,
    profile,
  ]),
])

const router = createRouter({
  routeTree,
  // Filled in by `App` from the live session.
  context: { session: null },
  // Unknown pages lead to the overview, or to signing in.
  defaultNotFoundComponent: () => <Navigate to="/" replace />,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const Router = ({ session }: { session: Session | null }) => {
  // Signing in or out runs the guards again, which move the viewer to the
  // overview or to signing in.
  const sessionId = session?.session.id
  const guarded = useRef(sessionId)
  useEffect(() => {
    if (guarded.current === sessionId) return
    guarded.current = sessionId
    void router.invalidate()
  }, [sessionId])

  return <RouterProvider router={router} context={{ session }} />
}

export const App = () => {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return null
  return <Router session={session} />
}
