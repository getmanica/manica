import { ArrowRightIcon } from 'lucide-react'
import { Link } from 'wouter'
import { required, useAppForm } from '@/components/form/app-form'
import { FieldGroup } from '@/components/ui/field'
import { AuthLayout } from '@/features/auth/auth-layout'
import { OtherSignIn } from '@/features/auth/other-sign-in'
import { MIN_PASSWORD_LENGTH, newPassword } from '@/features/auth/password'
import { authClient } from '@/lib/auth'

// Its own form, apart from signing in, so password managers see a sign-up
// form and offer to generate and save a new password.
export const SignUp = () => {
  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const { error } = await authClient.signUp.email({
        ...value,
        name: value.name.trim(),
      })
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
            Create your account
          </h2>
          <p className="text-muted-foreground text-sm">
            Set up an account to start running jobs on your agents.
          </p>
        </div>
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              <form.Field
                name="name"
                validators={[required('Enter your name')]}
              >
                {(field) => (
                  <field.Field>
                    <field.Label>Name</field.Label>
                    <field.TextInput
                      autoComplete="name"
                      placeholder="Ada Lovelace"
                      className="h-10"
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Field
                name="email"
                validators={[required('Enter your email')]}
              >
                {(field) => (
                  <field.Field>
                    <field.Label>Email</field.Label>
                    <field.TextInput
                      type="email"
                      autoComplete="username"
                      placeholder="you@example.com"
                      className="h-10"
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Field name="password" validators={[newPassword]}>
                {(field) => (
                  <field.Field>
                    <field.Label>Password</field.Label>
                    <field.PasswordInput
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD_LENGTH}
                      placeholder="Choose a password"
                      className="h-10"
                    />
                    <field.Description>
                      At least {MIN_PASSWORD_LENGTH} characters.
                    </field.Description>
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Errors />
              <form.SubmitButton size="lg" className="h-10 w-full">
                Create account
              </form.SubmitButton>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
        <OtherSignIn />
        <p className="text-center text-muted-foreground text-sm">
          Already have an account?{' '}
          <Link
            href="/login"
            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
          >
            Sign in
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
