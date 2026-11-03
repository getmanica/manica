import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import type { UserAction } from '@/features/admin/user-actions'
import type { AdminUser } from '@/features/admin/users'
import { api, errorDetail } from '@/lib/api'
import { authClient } from '@/lib/auth'

type Confirmed = Exclude<UserAction, 'ban'>

type BetterAuthResult = Promise<{ error: { message?: string } | null }>

// Each action through the admin plugin's endpoints, or plane's for
// removing, which check the caller is an admin.
const actions: Record<
  Confirmed,
  {
    title: (user: AdminUser) => string
    description: string
    confirm: string
    destructive?: boolean
    run: (userId: string) => BetterAuthResult
  }
> = {
  'make-admin': {
    title: (user) => `Make ${user.name} an admin?`,
    description:
      'Admins manage every user of the plane: they can ban, sign out and remove them, and make others admins.',
    confirm: 'Make admin',
    run: (userId) => authClient.admin.setRole({ userId, role: 'admin' }),
  },
  'remove-admin': {
    title: (user) => `Remove ${user.name} as an admin?`,
    description:
      'They keep their account and organizations, but lose access to the admin section at once.',
    confirm: 'Remove admin',
    run: (userId) => authClient.admin.setRole({ userId, role: 'user' }),
  },
  unban: {
    title: (user) => `Unban ${user.name}?`,
    description:
      'They can sign in again, and the apps they connected work again.',
    confirm: 'Unban',
    run: (userId) => authClient.admin.unbanUser({ userId }),
  },
  'sign-out': {
    title: (user) => `Sign ${user.name} out everywhere?`,
    description:
      'Every browser they are signed in on is signed out. They can sign back in.',
    confirm: 'Sign out',
    run: (userId) => authClient.admin.revokeUserSessions({ userId }),
  },
  remove: {
    title: (user) => `Remove ${user.name}?`,
    description:
      "Their account and sign-ins are deleted, with every organization only they are in, and its agents, forge apps and jobs. This can't be undone.",
    confirm: 'Remove',
    destructive: true,
    run: (userId) =>
      api.admin
        .users({ id: userId })
        .delete()
        .then(({ error }) => ({
          error: error ? { message: errorDetail(error) } : null,
        })),
  },
}

export const ConfirmUserActionDialog = ({
  action,
  user,
  open,
  onOpenChange,
  onDone,
}: {
  action: Confirmed
  user?: AdminUser
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const config = actions[action]

  const confirm = async () => {
    if (!user) return
    setPending(true)
    setError(null)
    const { error } = await config
      .run(user.id)
      .catch(() => ({ error: { message: undefined } }))
    setPending(false)
    if (error) {
      setError(error.message ?? 'Something went wrong')
      return
    }
    onDone()
    onOpenChange(false)
  }

  return (
    <AlertDialog
      open={open}
      // Stays open while the action is on its way: closing it then would let
      // its outcome land on whichever dialog opened next.
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open)
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setError(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{user && config.title(user)}</AlertDialogTitle>
          <AlertDialogDescription>{config.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={config.destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {config.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
