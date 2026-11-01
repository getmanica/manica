import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'

// Dialog body showing a freshly issued agent token, which is never shown
// again.
export const TokenReveal = ({
  title,
  token,
  onDone,
}: {
  title: string
  token: string
  onDone: () => void
}) => {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <FieldGroup>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          The agent uses this token to connect to Manica.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="agent-token">Token</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="agent-token"
            value={token}
            readOnly
            className="font-mono"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Copy token"
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        <FieldDescription>
          Copy it now: it won't be shown again.
        </FieldDescription>
      </Field>
      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </FieldGroup>
  )
}
