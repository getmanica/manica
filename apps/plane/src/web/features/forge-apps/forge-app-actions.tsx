import {
  ExternalLinkIcon,
  FolderPlusIcon,
  MoreVerticalIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type ForgeApp, forgeLabels } from '@/features/forge-apps/forge-apps'

export const ForgeAppActions = ({ app }: { app: ForgeApp }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${app.name}`}
        />
      }
    >
      <MoreVerticalIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-52">
      <DropdownMenuItem
        render={<a href={app.url} target="_blank" rel="noreferrer" />}
      >
        <ExternalLinkIcon />
        Open on {forgeLabels[app.forge]}
      </DropdownMenuItem>
      {app.installUrl && (
        <DropdownMenuItem render={<a href={app.installUrl} />}>
          <FolderPlusIcon />
          Install on repositories
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
)
