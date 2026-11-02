import { defaultRoles } from 'better-auth/plugins/organization/access'
import { and, eq } from 'drizzle-orm'
import { db } from '../platform/db'
import { member } from '../platform/db/schema'

// Who a request acts as, whatever authenticated it: a user, in one of their
// organizations. The console gets it from the session's active organization,
// MCP clients from the organization picked when the user connected them.
export type Principal = { userId: string; organizationId: string }

// The permissions a member's role must grant, in better-auth's access
// control terms (e.g. `{ organization: ['update'] }`).
export type Permissions = Parameters<
  (typeof defaultRoles)['owner']['authorize']
>[0]

// The roles `organization()` is set up with (see `auth/better-auth.ts`): the
// plugin's defaults.
const roles: Record<string, (typeof defaultRoles)[keyof typeof defaultRoles]> =
  defaultRoles

// The principal's role in the organization, or none if they aren't a member
// (e.g. they were removed since signing in or connecting).
export const memberRole = async ({ userId, organizationId }: Principal) => {
  const [found] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1)
  return found?.role
}

// Whether the principal's role grants all of `permissions`. Like better-auth's
// `hasPermission`, but for any principal, not only the cookie session's: a
// member may hold several roles, comma-separated, and any of them may grant
// them.
export const can = async (principal: Principal, permissions: Permissions) => {
  const role = await memberRole(principal)
  if (!role) return false
  return role
    .split(',')
    .some((name) => roles[name.trim()]?.authorize(permissions).success ?? false)
}
