import { createFileRoute } from '@tanstack/react-router'
import { Profile } from '@/features/profile/page'

export const Route = createFileRoute('/_signedIn/profile')({
  component: Profile,
})
