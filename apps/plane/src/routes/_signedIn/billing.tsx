import { createFileRoute } from '@tanstack/react-router'
import { BillingPage } from '@/features/billing/page'

// Shown only when the plane has billing; otherwise it leads to the overview.
export const Route = createFileRoute('/_signedIn/billing')({
  component: BillingPage,
})
