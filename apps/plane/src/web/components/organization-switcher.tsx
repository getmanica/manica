import { ChevronsUpDownIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CreateOrganizationDialog } from '@/components/create-organization-dialog'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { organizationAvatar } from '@/lib/avatar'

const OrganizationAvatar = ({
  organization,
  small,
}: {
  organization: { id: string; logo?: string | null }
  small?: boolean
}) => {
  const src = useMemo(
    () => organization.logo ?? organizationAvatar(organization.id),
    [organization.id, organization.logo],
  )
  return (
    <Avatar
      size={small ? 'sm' : 'default'}
      className="rounded-md after:rounded-md"
    >
      <AvatarImage src={src} alt="" className="rounded-md" />
    </Avatar>
  )
}

export const OrganizationSwitcher = () => {
  const { isMobile } = useSidebar()
  const { data: active } = authClient.useActiveOrganization()
  const { data: organizations } = authClient.useListOrganizations()
  const [creating, setCreating] = useState(false)

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
            {active ? (
              <OrganizationAvatar organization={active} />
            ) : (
              <span className="size-8 shrink-0 rounded-md bg-muted" />
            )}
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate font-medium">
                {active?.name ?? 'Select organization'}
              </span>
              <span className="truncate text-muted-foreground text-xs">
                Organization
              </span>
            </span>
            <ChevronsUpDownIcon className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={active?.id ?? ''}
                onValueChange={(organizationId: string) =>
                  void authClient.organization.setActive({ organizationId })
                }
              >
                {organizations?.map((organization) => (
                  <DropdownMenuRadioItem
                    key={organization.id}
                    value={organization.id}
                  >
                    <OrganizationAvatar organization={organization} small />
                    <span className="truncate">{organization.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreating(true)}>
              <PlusIcon />
              Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
