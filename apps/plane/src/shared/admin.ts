// Plane's own roles, from better-auth's admin plugin (see
// `api/auth/better-auth.ts`), not an organization's: admins manage the
// plane's users. Users without one (signed up before the plugin) are users.

// Whether a user's role makes them an admin. Like the plugin, a user may
// hold several roles, comma-separated, matched exactly.
export const isAdmin = (role: string | null | undefined) =>
  !!role?.split(',').includes('admin')
