import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { passkeyClient } from '@better-auth/passkey/client'
import { adminClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    // The plane's admins manage its users (see `features/admin`).
    adminClient(),
    organizationClient(),
    passkeyClient(),
    // Signing in during an MCP client's authorization carries its signed
    // request along, so better-auth picks the authorization back up after.
    oauthProviderClient(),
  ],
})
