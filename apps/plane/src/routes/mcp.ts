import { createFileRoute } from '@tanstack/react-router'
import { app } from '../api/app'

// The MCP server (see `api/mcp`).
export const Route = createFileRoute('/mcp')({
  server: { handlers: { ANY: ({ request }) => app.fetch(request) } },
})
