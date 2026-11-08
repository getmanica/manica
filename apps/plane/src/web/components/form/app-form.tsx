import {
  createErrorVisibility,
  createFormHook,
  createValidator,
} from '@tanstack/react-form'
import type { ComponentProps, ReactNode } from 'react'
import { fieldComponents } from '@/components/form/fields'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// Form components, rendered as `form.X` inside `form.AppForm`. They read the
// form from context, so they're declared here, next to the hook that provides
// it: `useFormContext` is only called once they render.

// Submits through the form; fields validate themselves, so the browser's
// own validation is off. Rendered on the server, a form can be submitted
// before its handler is attached: natively, as a POST, so what was typed
// (a password) never ends up in the URL.
const Form = (props: Omit<ComponentProps<'form'>, 'onSubmit'>) => {
  const form = useFormContext()
  return (
    <form
      id={form.formId}
      method="post"
      noValidate
      {...props}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    />
  )
}

// Spins, and is disabled, while the form submits. `icon` shows otherwise.
const SubmitButton = ({
  icon,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'type' | 'form'> & {
  icon?: ReactNode
}) => {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button
          {...props}
          type="submit"
          form={form.formId}
          disabled={props.disabled || isSubmitting}
        >
          {isSubmitting ? <Spinner data-icon="inline-start" /> : icon}
          {children}
        </Button>
      )}
    </form.Subscribe>
  )
}

// Form-level errors, such as the ones `onSubmit` returns from the server.
const Errors = () => {
  const form = useFormContext()
  return (
    <form.Subscribe selector={(state) => state.errors}>
      {(errors) =>
        errors.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {errors.map((error) => error.message).join('\n')}
            </AlertDescription>
          </Alert>
        )
      }
    </form.Subscribe>
  )
}

export const { useAppForm, useFormContext } = createFormHook({
  fieldComponents,
  formComponents: { Form, SubmitButton, Errors },
  defaultFormOptions: {
    // Calm while typing a first time; errors show once a field is left or
    // the form is submitted.
    errorVisibility: createErrorVisibility(
      ({ fieldState, state }) =>
        fieldState.meta.isBlurred || state.submissionAttempts > 0,
    ),
  },
})

// Validates when a field is left, then on every change while it's invalid,
// so a fix clears the error right away. Validators also run on submit.
export const validateOnBlur = createValidator({
  triggers: [
    'blur',
    {
      trigger: 'change',
      when: ({ fieldApi }) => fieldApi?.meta.isInvalid === true,
    },
  ],
})

// The usual check: a message when a value is missing.
export const required = (message: string) =>
  validateOnBlur(({ value }: { value: unknown }) =>
    value === null || (typeof value === 'string' && value.trim() === '')
      ? message
      : undefined,
  )
