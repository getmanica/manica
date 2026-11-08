import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../api/app'

// The API (see `api/app.ts`), better-auth included.
export const Route = createFileRoute('/api/$')({
  server: { handlers: { ANY: ({ request }) => app.fetch(request) } },
})
