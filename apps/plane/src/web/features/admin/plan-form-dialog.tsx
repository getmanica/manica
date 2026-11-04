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
import type { AdminPlan } from '@/features/admin/plans'
import { api, errorDetail } from '@/lib/api'

// Limits are typed as whole numbers; blank is unlimited.
const parseLimit = (value: string) =>
  value.trim() === '' ? null : Number(value.trim())

const limitError = validateOnBlur(({ value }: { value: string }) => {
  const limit = parseLimit(value)
  return limit === null || (Number.isInteger(limit) && limit >= 0)
    ? undefined
    : 'Use a whole number, or leave blank for unlimited'
})

const limitFields = [
  ['maxOrganizations', 'Organizations'],
  ['maxAgents', 'Agents'],
  ['maxForgeApps', 'Forge apps'],
] as const

const showLimit = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value)

// Mounted while the dialog is open, so each opening starts from `plan`.
const PlanForm = ({
  plan,
  onSaved,
}: {
  plan?: AdminPlan
  onSaved: () => void
}) => {
  const form = useAppForm({
    defaultValues: {
      name: plan?.name ?? '',
      description: plan?.description ?? '',
      monthlyPriceId: plan?.monthlyPriceId ?? '',
      yearlyPriceId: plan?.yearlyPriceId ?? '',
      enabled: plan?.enabled ?? true,
      maxOrganizations: showLimit(plan?.maxOrganizations),
      maxAgents: showLimit(plan?.maxAgents),
      maxForgeApps: showLimit(plan?.maxForgeApps),
    },
    onSubmit: async ({ value, createValidationError }) => {
      const body = {
        name: value.name.trim(),
        description: value.description.trim(),
        // The default plan has no prices.
        ...(!plan?.isDefault && {
          monthlyPriceId: value.monthlyPriceId.trim() || null,
          yearlyPriceId: value.yearlyPriceId.trim() || null,
        }),
        enabled: value.enabled,
        maxOrganizations: parseLimit(value.maxOrganizations),
        maxAgents: parseLimit(value.maxAgents),
        maxForgeApps: parseLimit(value.maxForgeApps),
      }
      const result = plan
        ? await api.admin.plans({ id: plan.id }).patch(body)
        : await api.admin.plans.post(body)
      if (result.error) return createValidationError(errorDetail(result.error))
      onSaved()
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>
              {plan ? `Edit ${plan.name}` : 'Create plan'}
            </DialogTitle>
            <DialogDescription>
              {plan?.isDefault
                ? 'Users without a subscription are on this plan.'
                : 'Create the product and its prices in Stripe first, then paste the price ids here.'}
            </DialogDescription>
          </DialogHeader>
          <form.Field name="name" validators={[required('Name the plan')]}>
            {(field) => (
              <field.Field>
                <field.Label>Name</field.Label>
                <field.TextInput placeholder="Pro" maxLength={64} />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <field.Field>
                <field.Label>Description</field.Label>
                <field.TextInput
                  placeholder="For teams running CI at scale"
                  maxLength={500}
                />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          {!plan?.isDefault && (
            <div className="grid grid-cols-2 gap-4">
              <form.Field
                name="monthlyPriceId"
                validators={[required('A plan needs a monthly price')]}
              >
                {(field) => (
                  <field.Field>
                    <field.Label>Monthly price id</field.Label>
                    <field.TextInput placeholder="price_…" autoComplete="off" />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Field name="yearlyPriceId">
                {(field) => (
                  <field.Field>
                    <field.Label>Yearly price id</field.Label>
                    <field.TextInput
                      placeholder="Optional"
                      autoComplete="off"
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            {limitFields.map(([name, label]) => (
              <form.Field key={name} name={name} validators={[limitError]}>
                {(field) => (
                  <field.Field>
                    <field.Label>{label}</field.Label>
                    <field.TextInput
                      inputMode="numeric"
                      placeholder="Unlimited"
                      autoComplete="off"
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
            ))}
          </div>
          {!plan?.isDefault && (
            <form.Field name="enabled">
              {(field) => (
                <field.Field orientation="horizontal">
                  <field.Checkbox />
                  <field.Label>
                    Offered to users (subscribers keep a disabled plan)
                  </field.Label>
                </field.Field>
              )}
            </form.Field>
          )}
          <form.Errors />
          <DialogFooter>
            <form.SubmitButton>{plan ? 'Save' : 'Create'}</form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

// Creates a plan; or, given a `plan`, edits it.
export const PlanFormDialog = ({
  plan,
  open,
  onOpenChange,
  onSaved,
}: {
  plan?: AdminPlan
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg">
      <PlanForm
        key={plan?.id}
        plan={plan}
        onSaved={() => {
          onSaved()
          onOpenChange(false)
        }}
      />
    </DialogContent>
  </Dialog>
)
