import { isAdmin } from '@shared/admin'
import {
  BanIcon,
  GiftIcon,
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
  | 'grant'
  | 'revoke-grant'
  | 'remove'

// What an admin can do to a user. Not to themselves: they'd lock themselves
// out (the API refuses banning or removing oneself anyway). Granting plans
// only while billing is on.
export const UserActions = ({
  user,
  self,
  billing,
  onAction,
}: {
  user: AdminUser
  self: boolean
  billing: boolean
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
      {billing && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onAction('grant', user)}>
            <GiftIcon />
            {user.grant ? 'Change granted plan' : 'Grant plan'}
          </DropdownMenuItem>
          {user.grant && (
            <DropdownMenuItem onClick={() => onAction('revoke-grant', user)}>
              <GiftIcon />
              Revoke granted plan
            </DropdownMenuItem>
          )}
        </>
      )}
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
