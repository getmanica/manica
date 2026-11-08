import { createFileRoute } from '@tanstack/react-router'
import { AdminPlans } from '@/features/admin/plans-page'

export const Route = createFileRoute('/_signedIn/admin/plans')({
  component: AdminPlans,
})
