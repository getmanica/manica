const required = (name: string) => {
  const value = Bun.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export const env = {
  port: Number(Bun.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  betterAuthUrl: required('BETTER_AUTH_URL'),
  betterAuthSecret: required('BETTER_AUTH_SECRET'),
}
