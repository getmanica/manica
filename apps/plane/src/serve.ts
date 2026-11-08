// The plane's process in production (`node dist/serve.js`): serves the
// console's assets and hands everything else to the Start build next to it,
// imported as the process starts so its checks and scheduled tasks run then,
// not on the first request.
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'

process.env.NODE_ENV ||= 'production'

const { default: server } = (await import(
  /* @vite-ignore */ new URL('./server/server.js', import.meta.url).href
)) as { default: { fetch: (request: Request) => Promise<Response> } }

const http = serve({
  port: Number(process.env.PORT ?? 3000),
  // Done below: srvx's own stops taking requests, but leaves the process
  // running (the scheduled tasks, the database pool).
  gracefulShutdown: false,
  middleware: [
    staticMiddleware({
      dir: new URL('./client', import.meta.url).pathname,
      // Built assets are named after their content.
      maxAge: 60 * 60 * 24 * 365,
      immutable: true,
    }),
  ],
  fetch: server.fetch,
})

// On SIGTERM (a container stopping) or SIGINT: finish the requests in
// flight, then the server's own work (`server.ts`), then exit.
const globals = globalThis as { planeShutdown?: () => Promise<void> }
let stopping = false
const stop = async (signal: NodeJS.Signals) => {
  if (stopping) return
  stopping = true
  console.log(`${signal}: shutting down`)
  try {
    await Promise.race([
      http.close(),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ])
    await http.close(true)
    await globals.planeShutdown?.()
  } catch (error) {
    console.error('shutdown failed:', error)
    process.exit(1)
  }
  process.exit(0)
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, (signal) => void stop(signal))
}
