const required = (name: string) => {
  const value = Bun.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

const production = Bun.env.NODE_ENV === 'production'

const betterAuthUrl = required('BETTER_AUTH_URL')

export const env = {
  production,
  port: Number(Bun.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  betterAuthUrl,
  betterAuthSecret: required('BETTER_AUTH_SECRET'),
  // Base URL forges deliver webhooks to; must be reachable from the forge.
  publicUrl: Bun.env.PUBLIC_URL || betterAuthUrl,
  encryptionKey: required('ENCRYPTION_KEY'),
}
