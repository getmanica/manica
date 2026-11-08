import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { passkeyClient } from '@better-auth/passkey/client'
import { stripeClient } from '@better-auth/stripe/client'
import { adminClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// Same origin (better-auth's default in the browser). On the server it's
// built but never called: the session comes from `lib/session`.
export const authClient = createAuthClient({
  plugins: [
    // The plane's admins manage its users (see `features/admin`).
    adminClient(),
    organizationClient(),
    passkeyClient(),
    // Signing in during an MCP client's authorization carries its signed
    // request along, so better-auth picks the authorization back up after.
    oauthProviderClient(),
    // Subscribing and the billing portal, when billing is on (see
    // `features/billing`); off, its endpoints don't exist and aren't called.
    stripeClient({ subscription: true }),
  ],
})
