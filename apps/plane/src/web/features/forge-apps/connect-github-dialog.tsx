import {
  type LucideIcon,
  RouteIcon,
  ServerIcon,
  ShieldCheckIcon,
  SquareArrowOutUpRightIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react'
import { useState } from 'react'
import { GitHubIcon } from '@/components/brand-icon'
import { useAppForm } from '@/components/form/app-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { followSetupRedirect } from '@/features/forge-apps/forge-apps'
import { api, errorDetail } from '@/lib/api'

// Where GitHub creates the app: the user's own account, or an organization
// they administer. Only the manifest's destination differs.
type Account = 'personal' | 'organization'

const points: { icon: LucideIcon; title: string; detail: string }[] = [
  {
    icon: ShieldCheckIcon,
    title: 'Only what runners need',
    detail:
      'It reads workflow jobs and registers just-in-time runners: nothing else.',
  },
  {
    icon: ServerIcon,
    title: 'Runs on your agents',
    detail: "Queued jobs that match an agent's labels run on your machines.",
  },
  {
    icon: RouteIcon,
    title: 'Finished on GitHub',
    detail:
      'GitHub asks you to confirm the app, then you install it on repositories.',
  },
]

const Points = () => (
  <ul className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4">
    {points.map(({ icon: Icon, title, detail }) => (
      <li key={title} className="flex gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-sm">{title}</span>
          <span className="text-muted-foreground text-sm">{detail}</span>
        </div>
      </li>
    ))}
  </ul>
)

// Mounted while the dialog is open, so each opening starts afresh.
const ConnectForm = ({ organizationName }: { organizationName: string }) => {
  const [account, setAccount] = useState<Account>('personal')
  const form = useAppForm({
    defaultValues: { owner: '' },
    onSubmit: async ({ value, createValidationError }) => {
      const owner = value.owner.trim()
      if (account === 'organization' && !owner) {
        return createValidationError('Enter the GitHub organization')
      }
      const { data, error } = await api['forge-apps'].setup.post({
        forge: 'github',
        owner: account === 'organization' ? owner : undefined,
      })
      if (error) return createValidationError(errorDetail(error))
      followSetupRedirect(data.redirect)
      // Stays submitting: the browser is leaving for GitHub.
      await new Promise<never>(() => {})
    },
  })

  const AccountIcon = account === 'personal' ? UserIcon : UsersIcon

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <Tabs
            value={account}
            onValueChange={(value) => setAccount(value as Account)}
          >
            <TabsList variant="line" className="w-full justify-start border-b">
              <TabsTrigger value="personal" className="flex-none px-3">
                <UserIcon />
                Personal account
              </TabsTrigger>
              <TabsTrigger value="organization" className="flex-none px-3">
                <UsersIcon />
                Organization
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full border bg-muted/30">
              <AccountIcon className="size-5 text-muted-foreground" />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {account === 'personal'
                  ? 'Your personal GitHub account'
                  : 'A GitHub organization'}
              </span>
              <span className="text-muted-foreground text-sm">
                Creates a GitHub App that sends queued workflow jobs to{' '}
                {organizationName}.
              </span>
            </div>
          </div>
          {account === 'organization' && (
            <form.Field name="owner">
              {(field) => (
                <field.Field>
                  <field.Label>Organization</field.Label>
                  <field.TextInput placeholder="acme" autoFocus />
                  <field.Description>
                    Its login on GitHub. You need to be one of its owners.
                  </field.Description>
                </field.Field>
              )}
            </form.Field>
          )}
          <Points />
          <form.Errors />
          <div className="flex flex-col gap-2">
            <form.SubmitButton
              size="lg"
              className="w-full"
              icon={<GitHubIcon data-icon="inline-start" />}
            >
              {account === 'personal'
                ? 'Create GitHub App on your account'
                : 'Create GitHub App on the organization'}
              <SquareArrowOutUpRightIcon data-icon="inline-end" />
            </form.SubmitButton>
            <p className="text-center text-muted-foreground text-xs">
              You'll be redirected to GitHub to finish.
            </p>
          </div>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

export const ConnectGitHubDialog = ({
  open,
  onOpenChange,
  organizationName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationName: string
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader className="flex-row items-center gap-3">
        <GitHubIcon className="size-8 shrink-0" />
        <div className="flex flex-col gap-1">
          <DialogTitle>Connect a GitHub app</DialogTitle>
          <DialogDescription>
            Send queued workflow jobs to your agents.
          </DialogDescription>
        </div>
      </DialogHeader>
      {open && <ConnectForm organizationName={organizationName} />}
    </DialogContent>
  </Dialog>
)
