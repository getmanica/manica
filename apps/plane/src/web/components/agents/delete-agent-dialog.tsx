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
import type { Agent } from '@/lib/agents'
import { api, errorDetail } from '@/lib/api'

export const DeleteAgentDialog = ({
  agent,
  open,
  onOpenChange,
  onDeleted,
}: {
  agent?: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const remove = async () => {
    if (!agent) return
    setPending(true)
    setError(null)
    const { error } = await api.agents({ id: agent.id }).delete()
    setPending(false)
    if (error) {
      setError(errorDetail(error))
      return
    }
    onDeleted()
    onOpenChange(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        if (!open) setError(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {agent?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The agent's token stops working and it won't receive any more jobs.
            This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
