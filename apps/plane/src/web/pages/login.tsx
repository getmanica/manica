import { useState } from 'react'
import { required, useAppForm } from '@/components/form/app-form'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { authClient } from '@/lib/auth'

export const Login = () => {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')

  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({
      value: { name, email, password },
      createValidationError,
    }) => {
      const { error } =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({ email, password, name })
      if (error) {
        return createValidationError(error.message ?? 'Something went wrong')
      }
    },
  })

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            {mode === 'sign-in' ? 'Sign in to Manica' : 'Create an account'}
          </CardTitle>
          <CardDescription>
            {mode === 'sign-in'
              ? 'Enter your email and password to continue.'
              : 'Set up an account to manage your runners.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form.AppForm>
            <form.Form>
              <FieldGroup>
                {mode === 'sign-up' && (
                  <form.Field
                    name="name"
                    validators={[required('Enter your name')]}
                  >
                    {(field) => (
                      <field.Field>
                        <field.Label>Name</field.Label>
                        <field.TextInput autoComplete="name" />
                        <field.Error />
                      </field.Field>
                    )}
                  </form.Field>
                )}
                <form.Field
                  name="email"
                  validators={[required('Enter your email')]}
                >
                  {(field) => (
                    <field.Field>
                      <field.Label>Email</field.Label>
                      <field.TextInput type="email" autoComplete="email" />
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
                      <field.TextInput
                        type="password"
                        autoComplete={
                          mode === 'sign-in'
                            ? 'current-password'
                            : 'new-password'
                        }
                      />
                      <field.Error />
                    </field.Field>
                  )}
                </form.Field>
                <form.Errors />
                <Field>
                  <form.SubmitButton>
                    {mode === 'sign-in' ? 'Sign in' : 'Sign up'}
                  </form.SubmitButton>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => {
                      // Errors from one mode don't apply to the other.
                      form.reset(form.state.values)
                      setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                    }}
                  >
                    {mode === 'sign-in'
                      ? "Don't have an account? Sign up"
                      : 'Already have an account? Sign in'}
                  </Button>
                </Field>
              </FieldGroup>
            </form.Form>
          </form.AppForm>
        </CardContent>
      </Card>
    </main>
  )
}
