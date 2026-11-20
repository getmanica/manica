import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ActivityIcon } from 'lucide-react'
import { useState } from 'react'
import { useAppForm, validateOnBlur } from '@/components/form/app-form'
import { Page } from '@/components/layout'
import { LoadError } from '@/components/loading'
import { SettingsSection } from '@/components/settings-section'
import { FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import {
  metricsRetentionDays as bounds,
  settingsQuery,
} from '@/features/settings/settings'
import { api, errorDetail } from '@/lib/api'
import { authClient } from '@/lib/auth'

const RetentionForm = ({
  organizationId,
  days,
}: {
  organizationId: string
  days: number
}) => {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const form = useAppForm({
    defaultValues: { days },
    onSubmit: async ({ value, createValidationError }) => {
      setSaved(false)
      const result = await api.organization.settings.patch({
        metricsRetentionDays: value.days,
      })
      if (result.error) return createValidationError(errorDetail(result.error))
      queryClient.setQueryData(
        settingsQuery(organizationId).queryKey,
        result.data,
      )
      setSaved(true)
    },
  })

  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field
            name="days"
            validators={[
              validateOnBlur(({ value }: { value: number }) =>
                Number.isInteger(value) &&
                value >= bounds.min &&
                value <= bounds.max
                  ? undefined
                  : `Use a whole number from ${bounds.min} to ${bounds.max}`,
              ),
            ]}
          >
            {(field) => (
              <field.Field>
                <field.Label>Keep readings for (days)</field.Label>
                <field.NumberInput
                  min={bounds.min}
                  max={bounds.max}
                  step={1}
                  className="max-w-32"
                />
                <field.Description>
                  Older readings are deleted within the hour. Shortening it
                  deletes the readings past the new length.
                </field.Description>
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Errors />
          <div className="flex items-center gap-3">
            <form.SubmitButton>Save</form.SubmitButton>
            {saved && (
              <span role="status" className="text-muted-foreground text-sm">
                Saved
              </span>
            )}
          </div>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  )
}

const Retention = ({ organizationId }: { organizationId: string }) => {
  const query = useQuery(settingsQuery(organizationId))
  if (query.isPending) return <Skeleton className="h-24 w-full" />
  if (query.isError) {
    return (
      <LoadError
        title="Couldn't load the settings"
        error={query.error}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  }
  return (
    // Remounted per organization, so the form starts from its settings.
    <RetentionForm
      key={organizationId}
      organizationId={organizationId}
      days={query.data.metricsRetentionDays}
    />
  )
}

export const Settings = () => {
  const { data: organization, isPending } = authClient.useActiveOrganization()

  return (
    <Page
      title="Settings"
      description={
        organization ? `Settings of ${organization.name}.` : undefined
      }
      describing={isPending}
    >
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : organization ? (
        <div className="flex flex-col gap-6">
          <SettingsSection
            icon={ActivityIcon}
            title="Agent metrics"
            description="How long the CPU, memory and disk readings agents report are kept, to chart on the Agents page."
          >
            <Retention organizationId={organization.id} />
          </SettingsSection>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization from the menu to change its settings.
        </p>
      )}
    </Page>
  )
}
