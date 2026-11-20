import { useState } from 'react'
import { useAppForm } from '@/components/form/app-form'
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
import type { AdminPlan } from '@/features/admin/plans'
import type { AdminUser } from '@/features/admin/users'
import { api, errorDetail } from '@/lib/api'

const DAY = 24 * 60 * 60

// How long a grant lasts, in seconds; `forever` until an admin revokes it.
const durations = {
  forever: 'Until revoked',
  [String(30 * DAY)]: '30 days',
  [String(90 * DAY)]: '90 days',
  [String(365 * DAY)]: '1 year',
} as Record<string, string>

const GrantPlanForm = ({
  user,
  plans,
  onPendingChange,
  onGranted,
}: {
  user: AdminUser
  // The plans that can be granted: any but the default.
  plans: AdminPlan[]
  onPendingChange: (pending: boolean) => void
  onGranted: () => void
}) => {
  const labels = Object.fromEntries(
    plans.map((plan) => [
      plan.id,
      plan.enabled ? plan.name : `${plan.name} (disabled)`,
    ]),
  )
  const form = useAppForm({
    defaultValues: {
      planId: (user.grant?.planId ?? plans[0]?.id ?? null) as string | null,
      duration: 'forever' as string | null,
      reason: '',
    },
    onSubmit: async ({ value, createValidationError }) => {
      if (!value.planId) return createValidationError('Pick a plan')
      const reason = value.reason.trim()
      onPendingChange(true)
      const { error } = await api.admin
        .users({ id: user.id })
        .grant.put({
          planId: value.planId,
          expiresIn:
            value.duration && value.duration !== 'forever'
              ? Number(value.duration)
              : undefined,
          reason: reason || undefined,
        })
        .catch(() => ({ error: { status: 0, value: null } }))
        .finally(() => onPendingChange(false))
      if (error) return createValidationError(errorDetail(error))
      onGranted()
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>
              {user.grant ? 'Change' : 'Grant'} {user.name}'s plan
            </DialogTitle>
            <DialogDescription>
              They're on it for free, in place of the default plan, and can't
              subscribe while the grant lasts. Users who pay for a subscription
              can't be granted one.
            </DialogDescription>
          </DialogHeader>
          <form.Field name="planId">
            {(field) => (
              <field.Field>
                <field.Label>Plan</field.Label>
                <field.Select field={field} labels={labels} />
              </field.Field>
            )}
          </form.Field>
          <form.Field name="duration">
            {(field) => (
              <field.Field>
                <field.Label>Duration</field.Label>
                <field.Select field={field} labels={durations} />
              </field.Field>
            )}
          </form.Field>
          <form.Field name="reason">
            {(field) => (
              <field.Field>
                <field.Label>Reason</field.Label>
                <field.TextInput placeholder="Optional" maxLength={200} />
              </field.Field>
            )}
          </form.Field>
          <form.Errors />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <form.SubmitButton>
              {user.grant ? 'Change plan' : 'Grant plan'}
            </form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

export const GrantPlanDialog = ({
  user,
  plans,
  open,
  onOpenChange,
  onGranted,
}: {
  user?: AdminUser
  plans: AdminPlan[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onGranted: () => void
}) => {
  // Stays open while the grant is on its way: closing it then would let its
  // outcome land on whichever dialog opened next.
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-md">
        {user && (
          <GrantPlanForm
            key={user.id}
            user={user}
            plans={plans}
            onPendingChange={setPending}
            onGranted={() => {
              onGranted()
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
