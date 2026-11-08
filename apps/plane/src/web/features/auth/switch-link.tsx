import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { pendingAuthorization } from '@/features/connected-apps/connected-apps'

// Between signing in and signing up. While an MCP client's authorization is
// pending, the link keeps its signed request as is (the router would
// rewrite it), so better-auth takes the user on once they're in.
export const SwitchLink = ({
  to,
  children,
}: {
  to: '/login' | '/signup'
  children: ReactNode
}) => {
  const className =
    'inline-flex items-center gap-1 font-medium text-foreground hover:underline'
  return pendingAuthorization() ? (
    <a href={`${to}?${pendingAuthorization()}`} className={className}>
      {children}
    </a>
  ) : (
    <Link to={to} className={className}>
      {children}
    </Link>
  )
}
