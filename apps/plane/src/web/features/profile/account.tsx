import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { required, useAppForm } from '@/components/form/app-form'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { ChangePasswordDialog } from '@/features/profile/change-password-dialog'
import { accountsQuery } from '@/features/profile/profile'
import { authClient } from '@/lib/auth'

type User = { name: string; email: string; emailVerified: boolean }

const DetailsForm = ({
  user,
  onSaved,
}: {
  user: User
  onSaved: () => void
}) => {
  const [saved, setSaved] = useState(false)
  const form = useAppForm({
    defaultValues: { name: user.name, email: user.email },
    onSubmit: async ({ value, createValidationError }) => {
      setSaved(false)
      const name = value.name.trim()
      const email = value.email.trim()
      if (name !== user.name) {
        const { error } = await authClient.updateUser({ name })
        if (error) {
          return createValidationError(error.message ?? 'Something went wrong')
        }
      }
      if (email !== user.email) {
        const { error } = await authClient.changeEmail({ newEmail: email })
        if (error) {
          return createValidationError(error.message ?? 'Something went wrong')
        }
      }
      onSaved()
      setSaved(true)
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field name="name" validators={[required('Enter your name')]}>
            {(field) => (
              <field.Field>
                <field.Label>Name</field.Label>
                <field.TextInput autoComplete="name" maxLength={128} />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Field name="email" validators={[required('Enter your email')]}>
            {(field) => (
              <field.Field>
                <field.Label>Email</field.Label>
                <field.TextInput
                  type="email"
                  autoComplete="email"
                  disabled={user.emailVerified}
                />
                {user.emailVerified && (
                  <field.Description>
                    Verified by GitHub, so it can't be changed here.
                  </field.Description>
                )}
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Errors />
          <div className="flex items-center gap-3">
            <form.SubmitButton>Save</form.SubmitButton>
            {saved && (
              <span role="status" className="text-muted-foreground text-sm">
                Saved
              </span>
            )}
          </div>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

// Whether the user has a password to change. Accounts made with GitHub or
// signed into with passkeys only have none.
const Password = () => {
  const { data: accounts, isPending, isError } = useQuery(accountsQuery)
  const [changing, setChanging] = useState(false)

  if (isPending) return <Skeleton className="h-9 w-full" />
  if (isError) return null
  const hasPassword = accounts.some(
    (account) => account.providerId === 'credential',
  )

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">Password</span>
        <span className="text-muted-foreground text-sm">
          {hasPassword
            ? 'Changing it signs out your other sessions.'
            : 'You sign in with GitHub or a passkey, without a password.'}
        </span>
      </div>
      {hasPassword && (
        <>
          <Button variant="outline" onClick={() => setChanging(true)}>
            Change password
          </Button>
          <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
        </>
      )}
    </div>
  )
}

export const Account = () => {
  const { data: session, refetch } = authClient.useSession()
  if (!session) return null
  return (
    <>
      <DetailsForm user={session.user} onSaved={() => void refetch()} />
      <Password />
    </>
  )
}
