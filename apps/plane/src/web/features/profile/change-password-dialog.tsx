import { required, useAppForm } from '@/components/form/app-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { MIN_PASSWORD_LENGTH, newPassword } from '@/features/auth/password'
import { authClient } from '@/lib/auth'

// Mounted while the dialog is open, so each opening starts empty.
const ChangePasswordForm = ({ onChanged }: { onChanged: () => void }) => {
  const form = useAppForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const { error } = await authClient.changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: true,
      })
      if (error) {
        return createValidationError(error.message ?? 'Something went wrong')
      }
      onChanged()
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Your other sessions are signed out; this one stays signed in.
            </DialogDescription>
          </DialogHeader>
          <form.Field
            name="currentPassword"
            validators={[required('Enter your current password')]}
          >
            {(field) => (
              <field.Field>
                <field.Label>Current password</field.Label>
                <field.PasswordInput autoComplete="current-password" />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Field name="newPassword" validators={[newPassword]}>
            {(field) => (
              <field.Field>
                <field.Label>New password</field.Label>
                <field.PasswordInput
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                />
                <field.Description>
                  At least {MIN_PASSWORD_LENGTH} characters.
                </field.Description>
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Errors />
          <DialogFooter>
            <form.SubmitButton>Change password</form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

export const ChangePasswordDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <ChangePasswordForm onChanged={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
)
