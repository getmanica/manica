import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Devtools } from '@/components/devtools'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionWatcher, sessionQuery } from '@/lib/session'
import { themeScript } from '@/lib/theme'
import styles from '@/styles.css?url'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  // Every page knows the viewer, on the server too: guards redirect before
  // anything renders.
  beforeLoad: async ({ context }) => ({
    session: await context.queryClient.fetchQuery(sessionQuery),
  }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Manica' },
    ],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  shellComponent: Document,
  component: () => (
    <TooltipProvider>
      <SessionWatcher />
      <Outlet />
    </TooltipProvider>
  ),
})

function Document({ children }: { children: ReactNode }) {
  return (
    // The theme script may change the class before React hydrates.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: our own constant */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Devtools />
        <Scripts />
      </body>
    </html>
  )
}
