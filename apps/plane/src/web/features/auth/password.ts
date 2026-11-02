import { validateOnBlur } from '@/components/form/app-form'

// better-auth's default minimum.
export const MIN_PASSWORD_LENGTH = 8

// For a new password's field.
export const newPassword = validateOnBlur(({ value }: { value: string }) =>
  value.length < MIN_PASSWORD_LENGTH
    ? `Use at least ${MIN_PASSWORD_LENGTH} characters`
    : undefined,
)
