import {
  type AnyFieldApi,
  type FieldWithValue,
  getFormHookHelpers,
} from '@tanstack/react-form'
import type { ComponentProps } from 'react'
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  Field as FieldPrimitive,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  SelectContent,
  SelectItem,
  Select as SelectPrimitive,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// The field components registered on `useAppForm`, rendered as `field.X`
// inside `form.Field`. `fieldComponent` injects the field API from context;
// `strict` exposes a component only on fields of exactly its value type.
const { fieldBrand, fieldComponent } = getFormHookHelpers()

// Scoped to the form so two forms on a page don't share element ids.
const fieldId = (field: AnyFieldApi) => `${field.form.formId}-${field.name}`

const Field = fieldComponent.loose(
  ({
    field,
    ...props
  }: ComponentProps<typeof FieldPrimitive> & { field: AnyFieldApi }) => (
    <FieldPrimitive data-invalid={field.meta.isInvalid} {...props} />
  ),
  'field',
)

const Label = fieldComponent.loose(
  ({
    field,
    ...props
  }: ComponentProps<typeof FieldLabel> & { field: AnyFieldApi }) => (
    <FieldLabel htmlFor={fieldId(field)} {...props} />
  ),
  'field',
)

const Description = fieldBrand.loose<unknown>()(FieldDescription)

// Only the errors `errorVisibility` lets through.
const Errors = fieldComponent.loose(
  ({
    field,
    ...props
  }: ComponentProps<typeof FieldError> & { field: AnyFieldApi }) => (
    <FieldError errors={field.errors} {...props} />
  ),
  'field',
)

type InputProps = Omit<
  ComponentProps<typeof Input>,
  'id' | 'name' | 'value' | 'onChange' | 'onBlur'
>

const TextInput = fieldComponent.strict(
  ({ field, ...props }: InputProps & { field: FieldWithValue<string> }) => (
    <Input
      {...props}
      id={fieldId(field)}
      name={field.name}
      value={field.value}
      onChange={(event) => field.handleChange(event.target.value)}
      onBlur={field.handleBlur}
      aria-invalid={field.meta.isInvalid}
    />
  ),
  'field',
)

const NumberInput = fieldComponent.strict(
  ({ field, ...props }: InputProps & { field: FieldWithValue<number> }) => (
    <Input
      {...props}
      type="number"
      id={fieldId(field)}
      name={field.name}
      // An emptied input is NaN; show it empty rather than "NaN".
      value={Number.isNaN(field.value) ? '' : field.value}
      onChange={(event) => field.handleChange(event.target.valueAsNumber)}
      onBlur={field.handleBlur}
      aria-invalid={field.meta.isInvalid}
    />
  ),
  'field',
)

// Generic over its options, so it's branded rather than wrapped (wrapping
// loses the generic): pass the field explicitly, `field={field}`.
const SelectInput = <Value extends string>({
  field,
  labels,
  placeholder = 'Select…',
}: {
  field: FieldWithValue<Value | null>
  labels: Record<NoInfer<Value>, string>
  placeholder?: string
}) => (
  <SelectPrimitive
    name={field.name}
    items={labels}
    value={field.value}
    onValueChange={(value) => field.handleChange(value)}
  >
    <SelectTrigger
      id={fieldId(field)}
      className="w-full"
      onBlur={field.handleBlur}
      aria-invalid={field.meta.isInvalid}
    >
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {(Object.entries(labels) as [Value, string][]).map(([value, text]) => (
        <SelectItem key={value} value={value}>
          {text}
        </SelectItem>
      ))}
    </SelectContent>
  </SelectPrimitive>
)

const Select = fieldBrand.loose<string | null>()(SelectInput)

export const fieldComponents = {
  Field,
  Label,
  Description,
  Error: Errors,
  TextInput,
  NumberInput,
  Select,
}
