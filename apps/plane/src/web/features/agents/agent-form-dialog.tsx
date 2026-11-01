import { useState } from 'react'
import {
  required,
  useAppForm,
  validateOnBlur,
} from '@/components/form/app-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
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

const MAX_SLOTS = 64

// Labels are typed as a list separated by commas or spaces.
const parseLabels = (value: string) =>
  value.split(/[\s,]+/).filter((label) => label.length > 0)

// Why the custom labels can't be saved, if they can't.
const labelsError = (labels: string[]) => {
  if (labels.length > MAX_CUSTOM_LABELS) {
    return `Use at most ${MAX_CUSTOM_LABELS} labels`
  }
  return labels.every(isValidLabel)
    ? undefined
    : `Labels can be at most ${MAX_LABEL_LENGTH} characters`
}

// Mounted while the dialog is open, so each opening starts from `agent`.
const AgentForm = ({
  agent,
  onSaved,
  onCreated,
  onClose,
}: {
  agent?: Agent
  onSaved: () => void
  onCreated: (token: string) => void
  onClose: () => void
}) => {
  const form = useAppForm({
    defaultValues: {
      name: agent?.name ?? '',
      os: agent?.os ?? (null as Agent['os'] | null),
      arch: agent?.arch ?? (null as Agent['arch'] | null),
      slots: agent?.slots ?? 1,
      labels: agent?.labels.join(', ') ?? '',
    },
    onSubmit: async ({ value, createValidationError }) => {
      const { os, arch } = value
      // Already checked by the fields' validators; this narrows the types.
      if (!os || !arch) return
      const body = {
        name: value.name.trim(),
        os,
        arch,
        slots: value.slots,
        labels: parseLabels(value.labels),
      }
      const result = agent
        ? await api.agents({ id: agent.id }).patch(body)
        : await api.agents.post(body)
      if (result.error) return createValidationError(errorDetail(result.error))
      onSaved()
      if ('token' in result.data) onCreated(result.data.token)
      else onClose()
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>{agent ? 'Edit agent' : 'Create agent'}</DialogTitle>
            <DialogDescription>
              {agent
                ? 'Changes apply the next time the agent connects.'
                : "Agents run on your machines and pick up your organization's CI jobs."}
            </DialogDescription>
          </DialogHeader>
          <form.Field
            name="name"
            validators={[required('Give the agent a name')]}
          >
            {(field) => (
              <field.Field>
                <field.Label>Name</field.Label>
                <field.TextInput placeholder="build-box-1" maxLength={64} />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <div className="grid grid-cols-2 gap-4">
            <form.Field
              name="os"
              validators={[required('Choose an operating system')]}
            >
              {(field) => (
                <field.Field>
                  <field.Label>Operating system</field.Label>
                  <field.Select field={field} labels={osLabels} />
                  <field.Error />
                </field.Field>
              )}
            </form.Field>
            <form.Field
              name="arch"
              validators={[required('Choose an architecture')]}
            >
              {(field) => (
                <field.Field>
                  <field.Label>Architecture</field.Label>
                  <field.Select field={field} labels={archLabels} />
                  <field.Error />
                </field.Field>
              )}
            </form.Field>
          </div>
          <form.Field
            name="slots"
            validators={[
              validateOnBlur(({ value }: { value: number }) =>
                Number.isInteger(value) && value >= 1 && value <= MAX_SLOTS
                  ? undefined
                  : `Use a whole number from 1 to ${MAX_SLOTS}`,
              ),
            ]}
          >
            {(field) => (
              <field.Field>
                <field.Label>Concurrent jobs</field.Label>
                <field.NumberInput min={1} max={MAX_SLOTS} step={1} />
                <field.Description>
                  How many jobs the machine runs at the same time.
                </field.Description>
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Field
            name="labels"
            validators={[
              validateOnBlur(({ value }: { value: string }) =>
                labelsError(parseLabels(value)),
              ),
            ]}
          >
            {(field) => (
              <field.Field>
                <field.Label>Labels</field.Label>
                <field.TextInput
                  placeholder="gpu, xcode-16"
                  autoComplete="off"
                />
                <field.Description>
                  {agent
                    ? `Extra runs-on labels, on top of: ${builtInLabels(agent).join(', ')}.`
                    : 'Extra runs-on labels, on top of the machine’s name, operating system and architecture.'}
                </field.Description>
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Errors />
          <DialogFooter>
            <form.SubmitButton>{agent ? 'Save' : 'Create'}</form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
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
  const [token, setToken] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        // Reset once the close animation is done, not while it plays.
        if (!open) setToken(null)
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
          <AgentForm
            key={agent?.id}
            agent={agent}
            onSaved={onSaved}
            onCreated={setToken}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
