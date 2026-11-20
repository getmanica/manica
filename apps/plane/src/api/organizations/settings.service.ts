import { eq } from 'drizzle-orm'
import { metricsRetentionDays } from '../../shared/organization-settings'
import { db } from '../platform/db'
import { organizationSettings } from '../platform/db/schema'

export type OrganizationSettings = { metricsRetentionDays: number }

const defaults: OrganizationSettings = {
  metricsRetentionDays: metricsRetentionDays.default,
}

const columns = {
  metricsRetentionDays: organizationSettings.metricsRetentionDays,
}

export const settingsService = {
  // The organization's settings, defaults for those never changed.
  async get(organizationId: string): Promise<OrganizationSettings> {
    const [found] = await db
      .select(columns)
      .from(organizationSettings)
      .where(eq(organizationSettings.organizationId, organizationId))
    return found ?? defaults
  },

  // Changes some of the organization's settings, returning them all.
  async update(
    organizationId: string,
    changes: Partial<OrganizationSettings>,
  ): Promise<OrganizationSettings> {
    const [updated] = await db
      .insert(organizationSettings)
      .values({ organizationId, ...changes })
      .onConflictDoUpdate({
        target: organizationSettings.organizationId,
        set: changes,
      })
      .returning(columns)
    if (!updated) throw new Error('No organization settings written')
    return updated
  },
}
