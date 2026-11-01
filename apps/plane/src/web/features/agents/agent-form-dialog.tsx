import { type FormEvent, useState } from 'react'
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  type Agent,
  archLabels,
  builtInLabels,
  isValidLabel,
  MAX_CUSTOM_LABELS,
  MAX_LABEL_LENGTH,
  osLabels,
} from '@/features/agents/agents'
import { TokenReveal } from '@/features/agents/token-reveal'
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

// Labels are typed as a list separated by commas or spaces.
const parseLabels = (value: string) =>
  value.split(/[\s,]+/).filter((label) => label.length > 0)

const readForm = (form: HTMLFormElement) => {
  const data = new FormData(form)
  return {
    name: String(data.get('name')).trim(),
    os: data.get('os') as Agent['os'] | null,
    arch: data.get('arch') as Agent['arch'] | null,
    slots: Number(data.get('slots')),
    labels: parseLabels(String(data.get('labels'))),
  }
}

// Why the custom labels can't be saved, if they can't.
const labelsError = (labels: string[]) => {
  if (labels.length > MAX_CUSTOM_LABELS) {
    return `Use at most ${MAX_CUSTOM_LABELS} labels`
  }
  return labels.every(isValidLabel)
    ? null
    : `Labels can be at most ${MAX_LABEL_LENGTH} characters`
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
    const { name, os, arch, slots, labels } = readForm(event.currentTarget)
    if (!os || !arch) {
      setError('Choose the machine’s operating system and architecture')
      return
    }
    const invalidLabels = labelsError(labels)
    if (invalidLabels) {
      setError(invalidLabels)
      return
    }

    setPending(true)
    setError(null)
    const result = agent
      ? await api.agents({ id: agent.id }).patch({
          name,
          os,
          arch,
          slots,
          labels,
        })
      : await api.agents.post({ name, os, arch, slots, labels })
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
              <Field>
                <FieldLabel htmlFor="agent-slots">Concurrent jobs</FieldLabel>
                <Input
                  id="agent-slots"
                  name="slots"
                  type="number"
                  min={1}
                  max={64}
                  step={1}
                  defaultValue={agent?.slots ?? 1}
                  required
                />
                <FieldDescription>
                  How many jobs the machine runs at the same time.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-labels">Labels</FieldLabel>
                <Input
                  id="agent-labels"
                  name="labels"
                  placeholder="gpu, xcode-16"
                  defaultValue={agent?.labels.join(', ')}
                  autoComplete="off"
                />
                <FieldDescription>
                  {agent
                    ? `Extra runs-on labels, on top of: ${builtInLabels(agent).join(', ')}.`
                    : 'Extra runs-on labels, on top of the machine’s name, operating system and architecture.'}
                </FieldDescription>
              </Field>
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
