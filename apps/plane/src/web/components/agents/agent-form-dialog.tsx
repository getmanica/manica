import { type FormEvent, useState } from 'react'
import { TokenReveal } from '@/components/agents/token-reveal'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { type Agent, archLabels, osLabels } from '@/lib/agents'
import { api, errorDetail } from '@/lib/api'

const PlatformSelect = <Value extends string>({
  id,
  name,
  label,
  labels,
  defaultValue,
}: {
  id: string
  name: string
  label: string
  labels: Record<Value, string>
  defaultValue?: Value
}) => (
  <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select
      name={name}
      items={labels}
      defaultValue={defaultValue ?? null}
      required
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(labels) as [Value, string][]).map(([value, text]) => (
          <SelectItem key={value} value={value}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Field>
)

const readForm = (form: HTMLFormElement) => {
  const data = new FormData(form)
  return {
    name: String(data.get('name')).trim(),
    os: data.get('os') as Agent['os'] | null,
    arch: data.get('arch') as Agent['arch'] | null,
  }
}

// Creates an agent, then shows its token; or, given an `agent`, edits it.
export const AgentFormDialog = ({
  agent,
  open,
  onOpenChange,
  onSaved,
}: {
  agent?: Agent
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const { name, os, arch } = readForm(event.currentTarget)
    if (!os || !arch) {
      setError('Choose the machine’s operating system and architecture')
      return
    }

    setPending(true)
    setError(null)
    const result = agent
      ? await api.agents({ id: agent.id }).patch({ name, os, arch })
      : await api.agents.post({ name, os, arch })
    setPending(false)
    if (result.error) {
      setError(errorDetail(result.error))
      return
    }
    onSaved()
    if ('token' in result.data) setToken(result.data.token)
    else onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        // Reset once the close animation is done, not while it plays.
        if (!open) {
          setError(null)
          setToken(null)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        {token ? (
          <TokenReveal
            title="Agent created"
            token={token}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          // Keyed so the fields reset to the agent being edited.
          <form key={agent?.id} onSubmit={(event) => void onSubmit(event)}>
            <FieldGroup>
              <DialogHeader>
                <DialogTitle>
                  {agent ? 'Edit agent' : 'Create agent'}
                </DialogTitle>
                <DialogDescription>
                  {agent
                    ? 'Changes apply the next time the agent connects.'
                    : "Agents run on your machines and pick up your organization's CI jobs."}
                </DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor="agent-name">Name</FieldLabel>
                <Input
                  id="agent-name"
                  name="name"
                  placeholder="build-box-1"
                  defaultValue={agent?.name}
                  maxLength={64}
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <PlatformSelect
                  id="agent-os"
                  name="os"
                  label="Operating system"
                  labels={osLabels}
                  defaultValue={agent?.os}
                />
                <PlatformSelect
                  id="agent-arch"
                  name="arch"
                  label="Architecture"
                  labels={archLabels}
                  defaultValue={agent?.arch}
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending && <Spinner data-icon="inline-start" />}
                  {agent ? 'Save' : 'Create'}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
