import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import type { Agent } from '@/features/agents/agents'
import { TokenReveal } from '@/features/agents/token-reveal'
import { api, errorDetail } from '@/lib/api'

export const RegenerateTokenDialog = ({
  agent,
  open,
  onOpenChange,
}: {
  agent?: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  const regenerate = async () => {
    if (!agent) return
    setPending(true)
    setError(null)
    const { data, error } = await api.agents({ id: agent.id }).token.post()
    setPending(false)
    if (error) {
      setError(errorDetail(error))
      return
    }
    setToken(data.token)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setError(null)
          setToken(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {token ? (
          <TokenReveal
            title="Token regenerated"
            token={token}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <FieldGroup>
            <DialogHeader>
              <DialogTitle>Regenerate token?</DialogTitle>
              <DialogDescription>
                {agent?.name} will be disconnected until it's configured with
                the new token. The current token stops working immediately.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button disabled={pending} onClick={() => void regenerate()}>
                {pending && <Spinner data-icon="inline-start" />}
                Regenerate
              </Button>
            </DialogFooter>
          </FieldGroup>
        )}
      </DialogContent>
    </Dialog>
  )
}
