import {
  KeyRoundIcon,
  MoreHorizontalIcon,
  PencilIcon,
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
import type { Agent } from '@/features/agents/agents'

export type AgentAction = 'edit' | 'regenerate-token' | 'delete'

export const AgentActions = ({
  agent,
  onAction,
}: {
  agent: Agent
  onAction: (action: AgentAction, agent: Agent) => void
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${agent.name}`}
        />
      }
    >
      <MoreHorizontalIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44">
      <DropdownMenuItem onClick={() => onAction('edit', agent)}>
        <PencilIcon />
        Edit
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onAction('regenerate-token', agent)}>
        <KeyRoundIcon />
        Regenerate token
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        variant="destructive"
        onClick={() => onAction('delete', agent)}
      >
        <Trash2Icon />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)
