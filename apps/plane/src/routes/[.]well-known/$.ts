import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../api/app'

// OAuth discovery, for MCP clients (see `api/mcp`).
export const Route = createFileRoute('/.well-known/$')({
  server: { handlers: { ANY: ({ request }) => app.fetch(request) } },
})
