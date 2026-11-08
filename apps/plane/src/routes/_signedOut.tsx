import { createFileRoute, redirect } from '@tanstack/react-router'
import { pendingAuthorization } from '@/features/connected-apps/connected-apps'

// Signed in, the sign-in pages lead to the overview.
export const Route = createFileRoute('/_signedOut')({
  beforeLoad: ({ context }) => {
    // While an MCP client's authorization is pending, signing in hands the
    // user back to better-auth, which takes them on (to consent): staying
    // put lets that happen, and lets a client ask the user to sign in again.
    if (context.session && !pendingAuthorization()) {
      throw redirect({ to: '/', replace: true })
    }
  },
})
