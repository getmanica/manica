import { Link, useMatchRoute } from '@tanstack/react-router'
import {
  LayoutDashboardIcon,
  ListChecksIcon,
  PlugIcon,
  ServerIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { OrganizationSwitcher } from '@/components/organization-switcher'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { UserMenu } from '@/components/user-menu'

const nav = [
  { to: '/', label: 'Overview', icon: LayoutDashboardIcon },
  { to: '/jobs', label: 'Jobs', icon: ListChecksIcon },
  { to: '/agents', label: 'Agents', icon: ServerIcon },
  { to: '/forge-apps', label: 'Forge apps', icon: PlugIcon },
] as const

const NavItem = ({ to, label, icon: Icon }: (typeof nav)[number]) => {
  // Nested pages (e.g. `/forge-apps/setup/success`) keep their section active.
  const active = !!useMatchRoute()({ to, fuzzy: to !== '/' })
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={label}
        render={<Link to={to} />}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const AppSidebar = () => (
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <OrganizationSwitcher />
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Platform</SidebarGroupLabel>
        <SidebarMenu>
          {nav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <UserMenu />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
)

// Mounted once around every signed-in route, so the sidebar keeps its state
// across navigations.
export const AppLayout = ({ children }: { children: ReactNode }) => (
  <SidebarProvider>
    <AppSidebar />
    <SidebarInset>{children}</SidebarInset>
  </SidebarProvider>
)

export const Page = ({
  title,
  heading = title,
  eyebrow,
  description,
  describing = false,
  actions,
  wide = false,
  children,
}: {
  // Names the page in the header bar, and heads it unless `heading` does.
  title: string
  heading?: ReactNode
  // A small line above the heading.
  eyebrow?: string
  description?: string
  // The description depends on something still loading: hold its place.
  describing?: boolean
  // Page-wide controls, beside the title.
  actions?: ReactNode
  // Room for wide tables.
  wide?: boolean
  children: ReactNode
}) => (
  <>
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-vertical:h-4 data-vertical:self-auto"
      />
      <span className="font-medium text-sm">{title}</span>
    </header>
    <div
      className={`mx-auto flex w-full flex-col gap-8 p-6 md:p-10 ${wide ? 'max-w-7xl' : 'max-w-5xl'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {eyebrow && (
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {eyebrow}
            </p>
          )}
          <h1 className="font-semibold text-2xl tracking-tight">{heading}</h1>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : (
            describing && <Skeleton className="my-0.5 h-4 w-72 max-w-full" />
          )}
        </div>
        {actions}
      </div>
      {children}
    </div>
  </>
)
