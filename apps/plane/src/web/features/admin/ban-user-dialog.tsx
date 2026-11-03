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
import type { AdminUser } from '@/features/admin/users'
import { api, errorDetail } from '@/lib/api'

const DAY = 24 * 60 * 60

// How long a ban lasts, in seconds; `forever` until an admin lifts it.
const durations = {
  forever: 'Until unbanned',
  [String(DAY)]: '1 day',
  [String(7 * DAY)]: '7 days',
  [String(30 * DAY)]: '30 days',
} as Record<string, string>

const BanUserForm = ({
  user,
  onPendingChange,
  onBanned,
}: {
  user: AdminUser
  onPendingChange: (pending: boolean) => void
  onBanned: () => void
}) => {
  const form = useAppForm({
    defaultValues: { reason: '', duration: 'forever' as string | null },
    onSubmit: async ({ value, createValidationError }) => {
      const reason = value.reason.trim()
      onPendingChange(true)
      const { error } = await api.admin
        .users({ id: user.id })
        .ban.post({
          reason: reason || undefined,
          expiresIn:
            value.duration && value.duration !== 'forever'
              ? Number(value.duration)
              : undefined,
        })
        .catch(() => ({ error: { status: 0, value: null } }))
        .finally(() => onPendingChange(false))
      if (error) return createValidationError(errorDetail(error))
      onBanned()
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>Ban {user.name}?</DialogTitle>
            <DialogDescription>
              They're signed out everywhere and can't sign back in, and the apps
              they connected stop working, while the ban lasts. Their
              organizations' agents keep running jobs.
            </DialogDescription>
          </DialogHeader>
          <form.Field name="reason">
            {(field) => (
              <field.Field>
                <field.Label>Reason</field.Label>
                <field.TextInput placeholder="Optional" maxLength={200} />
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
          <form.Errors />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <form.SubmitButton variant="destructive">Ban</form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

export const BanUserDialog = ({
  user,
  open,
  onOpenChange,
  onBanned,
}: {
  user?: AdminUser
  open: boolean
  onOpenChange: (open: boolean) => void
  onBanned: () => void
}) => {
  // Stays open while the ban is on its way: closing it then would let its
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
          <BanUserForm
            key={user.id}
            user={user}
            onPendingChange={setPending}
            onBanned={() => {
              onBanned()
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
