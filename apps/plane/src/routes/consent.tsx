import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { Consent } from '@/features/connected-apps/consent'

// Where better-auth sends the user when an MCP client asks for access,
// signing them in first. Outside the console's chrome: it's the app's page.
export const Route = createFileRoute('/consent')({
  validateSearch: z.object({
    client_id: z.string().optional().catch(undefined),
    scope: z.string().optional().catch(undefined),
  }),
  beforeLoad: ({ context, location }) => {
    // Signed out meanwhile: signing in carries the signed request along, as
    // the page's own query, so it must load with it.
    if (!context.session) {
      throw redirect({
        href: `/login${location.searchStr}`,
        reloadDocument: true,
        replace: true,
      })
    }
  },
  component: Consent,
})
