import { isAdmin } from '@shared/admin'
import { createFileRoute, redirect } from '@tanstack/react-router'

// The plane's admin section, for users whose own role (not an
// organization's) is admin. Everyone else is sent to the overview; the API
// refuses them too, whatever the page shows.
export const Route = createFileRoute('/_signedIn/admin')({
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.session?.user.role)) {
      throw redirect({ to: '/', replace: true })
    }
  },
})
