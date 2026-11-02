import { getRouteApi } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { useEffect } from 'react'
import { required, useAppForm } from '@/components/form/app-form'
import { FieldGroup } from '@/components/ui/field'
import { AuthLayout } from '@/features/auth/auth-layout'
import { OtherSignIn } from '@/features/auth/other-sign-in'
import { SwitchLink } from '@/features/auth/switch-link'
import { authClient } from '@/lib/auth'

const route = getRouteApi('/_signedOut/login')

// Its own form, apart from signing up, so password managers see a sign-in
// form with a current password to fill.
export const SignIn = () => {
  // Set by better-auth when signing in with GitHub fails.
  const { error: failed } = route.useSearch()

  // Offers saved passkeys in the email field's autofill. Signing in this way
  // updates the session, which takes the app past this page.
  useEffect(() => {
    void window.PublicKeyCredential?.isConditionalMediationAvailable?.().then(
      (available) => {
        if (available) void authClient.signIn.passkey({ autoFill: true })
      },
    )
  }, [])

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const { error } = await authClient.signIn.email(value)
      if (error) {
        return createValidationError(error.message ?? 'Something went wrong')
      }
    },
  })

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-2xl tracking-tight">
            Sign in to Manica
          </h2>
          <p className="text-muted-foreground text-sm">
            Enter your email and password to continue.
          </p>
        </div>
        {failed && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            Signing in with GitHub didn't work. Try again.
          </p>
        )}
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              <form.Field
                name="email"
                validators={[required('Enter your email')]}
              >
                {(field) => (
                  <field.Field>
                    <field.Label>Email</field.Label>
                    <field.TextInput
                      type="email"
                      autoComplete="username webauthn"
                      placeholder="you@example.com"
                      className="h-10"
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Field
                name="password"
                validators={[required('Enter your password')]}
              >
                {(field) => (
                  <field.Field>
                    <field.Label>Password</field.Label>
                    <field.PasswordInput
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      className="h-10"
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Errors />
              <form.SubmitButton size="lg" className="h-10 w-full">
                Sign in
              </form.SubmitButton>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
        <OtherSignIn passkey />
        <p className="text-center text-muted-foreground text-sm">
          Don't have an account?{' '}
          <SwitchLink to="/signup">
            Sign up
            <ArrowRightIcon className="size-3.5" />
          </SwitchLink>
        </p>
      </div>
    </AuthLayout>
  )
}
