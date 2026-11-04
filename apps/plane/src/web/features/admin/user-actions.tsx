import { isAdmin } from '@shared/admin'
import {
  BanIcon,
  LogOutIcon,
  MoreVerticalIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  Trash2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AdminUser } from '@/features/admin/users'

export type UserAction =
  | 'make-admin'
  | 'remove-admin'
  | 'ban'
  | 'unban'
  | 'sign-out'
  | 'remove'

// What an admin can do to a user. Not to themselves: they'd lock themselves
// out (the API refuses banning or removing oneself anyway).
export const UserActions = ({
  user,
  self,
  onAction,
}: {
  user: AdminUser
  self: boolean
  onAction: (action: UserAction, user: AdminUser) => void
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={self}
          aria-label={`Actions for ${user.name}`}
        />
      }
    >
      <MoreVerticalIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44">
      {isAdmin(user.role) ? (
        <DropdownMenuItem onClick={() => onAction('remove-admin', user)}>
          <ShieldOffIcon />
          Remove admin
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={() => onAction('make-admin', user)}>
          <ShieldCheckIcon />
          Make admin
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => onAction('sign-out', user)}>
        <LogOutIcon />
        Sign out everywhere
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {user.banned ? (
        <DropdownMenuItem onClick={() => onAction('unban', user)}>
          <BanIcon />
          Unban
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onAction('ban', user)}
        >
          <BanIcon />
          Ban
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        variant="destructive"
        onClick={() => onAction('remove', user)}
      >
        <Trash2Icon />
        Remove
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)
