const required = (name: string) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

const production = process.env.NODE_ENV === 'production'

const betterAuthUrl = required('BETTER_AUTH_URL')

// Signing in with GitHub, through a GitHub OAuth app (not a forge app): on
// when both its credentials are set.
const github = () => {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId && !clientSecret) return undefined
  if (!clientId || !clientSecret) {
    throw new Error(
      'Set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither',
    )
  }
  return { clientId, clientSecret }
}

// Billing, through Stripe: on when its API key is set, which then also takes
// the secret Stripe signs webhooks with. Off, plane has no plans or limits.
const stripe = () => {
  const apiKey = process.env.STRIPE_API_KEY
  if (!apiKey) return undefined
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required with STRIPE_API_KEY')
  }
  return { apiKey, webhookSecret }
}

export const env = {
  production,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  betterAuthUrl,
  betterAuthSecret: required('BETTER_AUTH_SECRET'),
  // Base URL forges deliver webhooks to; must be reachable from the forge.
  publicUrl: process.env.PUBLIC_URL || betterAuthUrl,
  encryptionKey: required('ENCRYPTION_KEY'),
  githubSignIn: github(),
  stripe: stripe(),
}
