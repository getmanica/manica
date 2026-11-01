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
import { authClient } from '@/lib/auth'

// Slugs are unique but never shown, so a random suffix avoids collisions.
const slugFor = (name: string) => {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = Math.random().toString(36).slice(2, 8)
  return base ? `${base}-${suffix}` : suffix
}

export const CreateOrganizationDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const form = useAppForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const name = value.name.trim()
      // Creating an organization also makes it the active one.
      const { error } = await authClient.organization.create({
        name,
        slug: slugFor(name),
      })
      if (error) {
        return createValidationError(error.message ?? 'Something went wrong')
      }
      onOpenChange(false)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        // Reset once the close animation is done, not while it plays.
        if (!open) form.reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form.AppForm>
          <form.Form>
            <FieldGroup>
              <DialogHeader>
                <DialogTitle>Create organization</DialogTitle>
                <DialogDescription>
                  Organizations own forge apps and runners, and can be shared
                  with others.
                </DialogDescription>
              </DialogHeader>
              <form.Field
                name="name"
                validators={[required('Give the organization a name')]}
              >
                {(field) => (
                  <field.Field>
                    <field.Label>Name</field.Label>
                    <field.TextInput autoComplete="organization" />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Errors />
              <DialogFooter>
                <form.SubmitButton>Create</form.SubmitButton>
              </DialogFooter>
            </FieldGroup>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  )
}
