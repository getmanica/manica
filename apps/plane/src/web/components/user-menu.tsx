import { Link } from '@tanstack/react-router'
import { ChevronsUpDownIcon, LogOutIcon, UserIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { authClient } from '@/lib/auth'
import { userAvatar } from '@/lib/avatar'
import { useSession } from '@/lib/session'

type User = { id: string; name: string; email: string; image?: string | null }

const UserIdentity = ({ user, avatar }: { user: User; avatar: string }) => (
  <>
    <Avatar>
      <AvatarImage src={avatar} alt="" />
    </Avatar>
    <span className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{user.name}</span>
      <span className="truncate text-muted-foreground text-xs">
        {user.email}
      </span>
    </span>
  </>
)

export const UserMenu = () => {
  const { isMobile } = useSidebar()
  const { data: session } = useSession()
  const user = session?.user
  const avatar = useMemo(
    () => (user ? (user.image ?? userAvatar(user.id)) : ''),
    [user],
  )

  if (!user) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <UserIdentity user={user} avatar={avatar} />
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                <UserIdentity user={user} avatar={avatar} />
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/profile" />}>
              <UserIcon />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void authClient.signOut()}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
