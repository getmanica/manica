const required = (name: string) => {
  const value = Bun.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

const production = Bun.env.NODE_ENV === 'production'

export const env = {
  production,
  port: Number(Bun.env.PORT ?? 3000),
  // Unset in development falls back to an embedded PGlite database.
  databaseUrl: production ? required('DATABASE_URL') : Bun.env.DATABASE_URL,
  betterAuthUrl: required('BETTER_AUTH_URL'),
  betterAuthSecret: required('BETTER_AUTH_SECRET'),
}
