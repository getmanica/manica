import { app } from './app'
import { runMigrations } from './db'
import { env } from './env'
import web from './web/index.html'

await runMigrations()

const server = Bun.serve({
  port: env.port,
  development: !env.production && { hmr: true, console: true },
  routes: {
    '/api/*': app.fetch,
    '/*': web,
  },
})

console.log(`plane listening on ${server.url}`)
