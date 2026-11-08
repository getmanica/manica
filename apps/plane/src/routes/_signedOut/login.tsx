import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '@/features/auth/sign-in'
import { optional } from '@/lib/search'

export const Route = createFileRoute('/_signedOut/login')({
  // Set by better-auth when signing in with GitHub fails.
  validateSearch: z.object({ error: optional }),
  component: SignIn,
})
