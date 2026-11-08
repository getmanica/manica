import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppLayout } from '@/components/layout'

// Signed out, every page but signing in leads to signing in.
export const Route = createFileRoute('/_signedIn')({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: '/login', replace: true })
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
})
