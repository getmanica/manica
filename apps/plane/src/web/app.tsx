import { isAdmin } from '@shared/admin'
import { jobRanges, overviewRanges } from '@shared/job-ranges'
import {
  agentSorts,
  defaultPageSize,
  forgeAppSorts,
  jobSorts,
  pageSizes,
  sortDirections,
  userSorts,
} from '@shared/pagination'
import { platformKeys } from '@shared/platform'
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
import { AdminUsers } from '@/features/admin/page'
import { AdminPlans } from '@/features/admin/plans-page'
import { Agents } from '@/features/agents/page'
import { SignIn } from '@/features/auth/sign-in'
import { SignUp } from '@/features/auth/sign-up'
import { BillingPage } from '@/features/billing/page'
import { pendingAuthorization } from '@/features/connected-apps/connected-apps'
import { Consent } from '@/features/connected-apps/consent'
import { ForgeApps } from '@/features/forge-apps/page'
import {
  ForgeAppSetupError,
  ForgeAppSetupSuccess,
} from '@/features/forge-apps/setup'
import { Jobs } from '@/features/jobs/page'
import { Overview } from '@/features/overview/page'
import { Profile } from '@/features/profile/page'
import { authClient } from '@/lib/auth'
import { queryClient } from '@/lib/query'

type Session = typeof authClient.$Infer.Session

// Page state kept in the URL, so a reload or a shared link shows the same
// view. Invalid values fall back to the default, and values equal to their
// default are left out of the URL.
const text = z.string().default('').catch('')
const list = z.array(z.string()).default([]).catch([])
const optional = z.string().optional().catch(undefined)

// A paged table's page, page size and sort, newest first by default.
const paged = <const Sorts extends readonly [string, ...string[]]>(
  sorts: Sorts,
  sort: Sorts[number],
) => ({
  page: z.number().int().min(1).default(1).catch(1),
  size: z.literal(pageSizes).default(defaultPageSize).catch(defaultPageSize),
  sort: z.enum(sorts).default(sort).catch(sort),
  dir: z.enum(sortDirections).default('desc').catch('desc'),
})

const overviewSearch = z.object({
  range: z.enum(overviewRanges).default('24h').catch('24h'),
})
const jobsSearch = z.object({
  ...paged(jobSorts, 'queuedAt'),
  q: text,
  status: list,
  hide: list,
  range: z.enum(jobRanges).default('24h').catch('24h'),
})
const agentsSearch = z.object({
  ...paged(agentSorts, 'createdAt'),
  q: text,
  platform: z.array(z.enum(platformKeys)).default([]).catch([]),
  hide: list,
})
const forgeAppsSearch = z.object({
  ...paged(forgeAppSorts, 'createdAt'),
  q: text,
})

const usersSearch = z.object({
  ...paged(userSorts, 'createdAt'),
  q: text,
})

const root = createRootRouteWithContext<{ session: Session | null }>()({
  component: Outlet,
})

// Signed in, the sign-in pages lead to the overview; signed out, every other
// page leads to signing in.

const signedOut = createRoute({
  getParentRoute: () => root,
  id: '_signedOut',
  beforeLoad: ({ context }) => {
    // While an MCP client's authorization is pending, signing in hands the
    // user back to better-auth, which takes them on (to consent): staying
    // put lets that happen, and lets a client ask the user to sign in again.
    if (context.session && !pendingAuthorization) {
      throw redirect({ to: '/', replace: true })
    }
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

// Where better-auth sends the user when an MCP client asks for access,
// signing them in first. Outside the console's chrome: it's the app's page.
const consent = createRoute({
  getParentRoute: () => root,
  path: 'consent',
  validateSearch: z.object({
    client_id: z.string().optional().catch(undefined),
    scope: z.string().optional().catch(undefined),
  }),
  beforeLoad: ({ context }) => {
    // Signed out meanwhile: signing in carries the signed request along, as
    // the page's own query, so it must load with it.
    if (!context.session) {
      throw redirect({
        href: `/login${window.location.search}`,
        reloadDocument: true,
        replace: true,
      })
    }
  },
  component: Consent,
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

// Shown only when the plane has billing; otherwise it leads to the overview.
const billing = createRoute({
  getParentRoute: () => signedIn,
  path: 'billing',
  component: BillingPage,
})

const profile = createRoute({
  getParentRoute: () => signedIn,
  path: 'profile',
  component: Profile,
})

// The plane's admin section, for users whose own role (not an
// organization's) is admin. Everyone else is sent to the overview; the API
// refuses them too, whatever the page shows.
const admin = createRoute({
  getParentRoute: () => signedIn,
  path: 'admin',
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.session?.user.role)) {
      throw redirect({ to: '/', replace: true })
    }
  },
})

const adminIndex = createRoute({
  getParentRoute: () => admin,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/users', replace: true })
  },
})

const adminUsers = createRoute({
  getParentRoute: () => admin,
  path: 'users',
  validateSearch: usersSearch,
  search: { middlewares: [stripSearchParams(usersSearch.parse({}))] },
  component: AdminUsers,
})

const adminPlans = createRoute({
  getParentRoute: () => admin,
  path: 'plans',
  component: AdminPlans,
})

const routeTree = root.addChildren([
  signedOut.addChildren([login, signup]),
  consent,
  signedIn.addChildren([
    overview,
    jobs,
    agents,
    forgeApps,
    forgeAppSetupSuccess,
    forgeAppSetupError,
    billing,
    profile,
    admin.addChildren([adminIndex, adminUsers, adminPlans]),
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
  // Signing in or out, or gaining or losing the admin role, runs the guards
  // again, which move the viewer to the overview or to signing in.
  const guard = `${session?.session.id}:${isAdmin(session?.user.role)}`
  const guarded = useRef(guard)
  // Another user, or none: what was cached was the previous one's.
  const userId = session?.user.id
  const cachedFor = useRef(userId)
  useEffect(() => {
    if (cachedFor.current === userId) return
    cachedFor.current = userId
    queryClient.clear()
  }, [userId])
  useEffect(() => {
    if (guarded.current === guard) return
    guarded.current = guard
    void router.invalidate()
  }, [guard])

  return <RouterProvider router={router} context={{ session }} />
}

export const App = () => {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return null
  return <Router session={session} />
}
