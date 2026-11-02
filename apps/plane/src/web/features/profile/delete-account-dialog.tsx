import { useQuery } from '@tanstack/react-query'
import { required, useAppForm } from '@/components/form/app-form'
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
import { accountsQuery } from '@/features/profile/profile'
import { authClient } from '@/lib/auth'

// better-auth asks for the password when there is one; without, it wants a
// recent sign-in instead.
const DeleteAccountForm = ({ hasPassword }: { hasPassword: boolean }) => {
  const form = useAppForm({
    defaultValues: { password: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const { error } = await authClient.deleteUser(
        hasPassword ? { password: value.password } : {},
      )
      if (error) {
        return createValidationError(
          error.code === 'SESSION_EXPIRED'
            ? 'Sign out and back in, then delete your account.'
            : (error.message ?? 'Something went wrong'),
        )
      }
      // A full load drops everything cached for the deleted user.
      window.location.assign('/login')
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your account, its sign-ins, and every organization only you are in
              are deleted, with their agents, forge apps and jobs. This can't be
              undone.
            </DialogDescription>
          </DialogHeader>
          {hasPassword && (
            <form.Field
              name="password"
              validators={[required('Enter your password')]}
            >
              {(field) => (
                <field.Field>
                  <field.Label>Password</field.Label>
                  <field.PasswordInput autoComplete="current-password" />
                  <field.Error />
                </field.Field>
              )}
            </form.Field>
          )}
          <form.Errors />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <form.SubmitButton variant="destructive">
              Delete account
            </form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

export const DeleteAccountDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { data: accounts } = useQuery(accountsQuery)
  const hasPassword =
    accounts?.some((account) => account.providerId === 'credential') ?? true

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DeleteAccountForm
          key={String(hasPassword)}
          hasPassword={hasPassword}
        />
      </DialogContent>
    </Dialog>
  )
}
