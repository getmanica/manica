import { LayoutDashboardIcon, PlugIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useRoute } from 'wouter'
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
import { UserMenu } from '@/components/user-menu'

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboardIcon },
  { href: '/forge-apps', label: 'Forge apps', icon: PlugIcon },
]

const NavItem = ({ href, label, icon: Icon }: (typeof nav)[number]) => {
  // Nested pages (e.g. `/forge-apps/setup/success`) keep their section active.
  const [exact] = useRoute(href)
  const [nested] = useRoute(`${href}/*`)
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={exact || (href !== '/' && nested)}
        tooltip={label}
        render={<Link href={href} />}
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
            <NavItem key={item.href} {...item} />
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
  description,
  children,
}: {
  title: string
  description?: string
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </div>
  </>
)
