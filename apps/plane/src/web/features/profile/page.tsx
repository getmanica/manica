import {
  FingerprintIcon,
  MonitorIcon,
  PlugIcon,
  Trash2Icon,
  UserIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Page } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { ConnectedApps } from '@/features/connected-apps/connected-apps-list'
import { Account } from '@/features/profile/account'
import { Appearance } from '@/features/profile/appearance'
import { DeleteAccountDialog } from '@/features/profile/delete-account-dialog'
import { Passkeys } from '@/features/profile/passkeys'
import { SettingsSection } from '@/components/settings-section'

const DangerZone = () => {
  const [deleting, setDeleting] = useState(false)
  return (
    <div className="flex h-full items-center md:justify-end">
      <Button
        variant="outline"
        className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setDeleting(true)}
      >
        Delete account
      </Button>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </div>
  )
}

export const Profile = () => (
  <Page
    title="Profile"
    description="Manage your account, how you sign in, and how the console looks."
  >
    <div className="flex flex-col gap-6">
      <SettingsSection
        icon={UserIcon}
        title="Account"
        description="Your name, email, and password."
      >
        <Account />
      </SettingsSection>
      <SettingsSection
        icon={FingerprintIcon}
        title="Passkeys"
        description="Sign in with your fingerprint, face, or a security key instead of a password."
      >
        <Passkeys />
      </SettingsSection>
      <SettingsSection
        icon={PlugIcon}
        title="Connected apps"
        description="MCP clients you let use an organization for you, like Claude Code or Cursor."
      >
        <ConnectedApps />
      </SettingsSection>
      <SettingsSection
        icon={MonitorIcon}
        title="Appearance"
        description="How the console looks in this browser."
      >
        <Appearance />
      </SettingsSection>
      <SettingsSection
        icon={Trash2Icon}
        title="Danger zone"
        description="Irreversible and destructive actions."
        destructive
      >
        <DangerZone />
      </SettingsSection>
    </div>
  </Page>
)
