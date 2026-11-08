import { createRouter, Navigate } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createQueryClient } from '@/lib/query'
import { routeTree } from './routeTree.gen'

// A router per request on the server, with its own query cache, whose
// queries carry over to the browser's.
export const getRouter = () => {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Unknown pages lead to the overview, or to signing in.
    defaultNotFoundComponent: () => <Navigate to="/" replace />,
  })
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
