import { CopyIcon, ExternalLinkIcon, MoreVerticalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Job } from '@/features/jobs/jobs'

export const JobActions = ({ job }: { job: Job }) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${job.name}`}
        />
      }
    >
      <MoreVerticalIcon />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44">
      <DropdownMenuItem
        render={<a href={job.url} target="_blank" rel="noreferrer" />}
      >
        <ExternalLinkIcon />
        Open on GitHub
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void navigator.clipboard.writeText(job.url)}
      >
        <CopyIcon />
        Copy job URL
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)
