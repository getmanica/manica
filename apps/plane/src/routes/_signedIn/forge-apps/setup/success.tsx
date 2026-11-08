import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ForgeAppSetupSuccess } from '@/features/forge-apps/setup'
import { optional } from '@/lib/search'

// Landing page for `GET /api/forge-apps/setup/callback`.
export const Route = createFileRoute('/_signedIn/forge-apps/setup/success')({
  validateSearch: z.object({ app: optional }),
  component: ForgeAppSetupSuccess,
})
