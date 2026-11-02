import { PASSKEY_ERROR_CODES } from '@better-auth/passkey/client'
import {
  KeyRoundIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { useAppForm } from '@/components/form/app-form'
import { LoadError } from '@/components/loading'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { authClient } from '@/lib/auth'
import { formatDate } from '@/lib/format'

type Passkey = { id: string; name?: string | null; createdAt: Date | string }

const label = (passkey: Passkey) => passkey.name || 'Unnamed passkey'

// Names a passkey, new or existing: only to tell them apart in the list.
const NameForm = ({
  passkey,
  onDone,
}: {
  passkey?: Passkey
  onDone: () => void
}) => {
  const form = useAppForm({
    defaultValues: { name: passkey?.name ?? '' },
    onSubmit: async ({ value, createValidationError }) => {
      const name = value.name.trim()
      const { error } = passkey
        ? await authClient.passkey.updatePasskey({ id: passkey.id, name })
        : await authClient.passkey.addPasskey(name ? { name } : undefined)
      // Closing the browser's prompt just leaves the dialog open.
      if (
        error &&
        error.message !== PASSKEY_ERROR_CODES.REGISTRATION_CANCELLED.message
      ) {
        return createValidationError(error.message ?? 'Something went wrong')
      }
      if (!error) onDone()
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <DialogHeader>
            <DialogTitle>
              {passkey ? 'Rename passkey' : 'Add passkey'}
            </DialogTitle>
            <DialogDescription>
              {passkey
                ? 'The name only tells your passkeys apart.'
                : 'Your browser asks you to create a passkey on this device or a security key. Use it to sign in instead of a password.'}
            </DialogDescription>
          </DialogHeader>
          <form.Field name="name">
            {(field) => (
              <field.Field>
                <field.Label>Name</field.Label>
                <field.TextInput
                  placeholder="MacBook Touch ID"
                  autoComplete="off"
                  maxLength={64}
                />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Errors />
          <DialogFooter>
            <form.SubmitButton
              icon={
                passkey ? undefined : <KeyRoundIcon data-icon="inline-start" />
              }
            >
              {passkey ? 'Save' : 'Create passkey'}
            </form.SubmitButton>
          </DialogFooter>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

const DeletePasskeyDialog = ({
  passkey,
  open,
  onOpenChange,
}: {
  passkey?: Passkey
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const remove = async () => {
    if (!passkey) return
    setPending(true)
    setError(null)
    const { error } = await authClient.passkey.deletePasskey({ id: passkey.id })
    setPending(false)
    if (error) {
      setError(error.message ?? 'Something went wrong')
      return
    }
    onOpenChange(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(open) => {
        if (!open) setError(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {passkey ? label(passkey) : 'passkey'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            You won't be able to sign in with it anymore. Remove it from your
            device or password manager too.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => void remove()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const PasskeyRow = ({
  passkey,
  onRename,
  onDelete,
}: {
  passkey: Passkey
  onRename: () => void
  onDelete: () => void
}) => (
  <li className="flex items-center gap-3 px-4 py-3">
    <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-medium text-sm">{label(passkey)}</span>
      <span className="text-muted-foreground text-xs">
        Added {formatDate(passkey.createdAt)}
      </span>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${label(passkey)}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </li>
)

export const Passkeys = () => {
  const {
    data: passkeys,
    isPending,
    error,
    refetch,
  } = authClient.useListPasskeys()
  // The passkey being renamed (none when adding one) or deleted. Kept while
  // its dialog closes, so the dialog doesn't change under the animation.
  const [renaming, setRenaming] = useState<Passkey | undefined>(undefined)
  const [naming, setNaming] = useState(false)
  const [deleting, setDeleting] = useState<Passkey | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      {isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : error && !passkeys ? (
        <LoadError
          title="Couldn't load passkeys"
          error={new Error(error.message ?? 'Something went wrong')}
          retrying={false}
          onRetry={() => void refetch()}
        />
      ) : passkeys && passkeys.length > 0 ? (
        <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              onRename={() => {
                setRenaming(passkey)
                setNaming(true)
              }}
              onDelete={() => {
                setDeleting(passkey)
                setConfirming(true)
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No passkeys yet. Add one to sign in with your fingerprint, face, or a
          security key.
        </p>
      )}
      <div>
        <Button
          variant="outline"
          onClick={() => {
            setRenaming(undefined)
            setNaming(true)
          }}
        >
          <PlusIcon data-icon="inline-start" />
          Add passkey
        </Button>
      </div>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-md">
          <NameForm
            key={renaming?.id ?? 'new'}
            passkey={renaming}
            onDone={() => setNaming(false)}
          />
        </DialogContent>
      </Dialog>
      <DeletePasskeyDialog
        passkey={deleting}
        open={confirming}
        onOpenChange={setConfirming}
      />
    </>
  )
}
