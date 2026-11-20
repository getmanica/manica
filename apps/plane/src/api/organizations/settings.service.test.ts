import { beforeEach, expect, test } from 'vitest'
import { createOrganization } from '../../../test/fixtures'
import { settingsService } from './settings.service'

let organizationId: string

beforeEach(async () => {
  ;({ organizationId } = await createOrganization())
})

test('defaults the settings never changed', async () => {
  expect(await settingsService.get(organizationId)).toEqual({
    metricsRetentionDays: 30,
  })
})

test('changes them', async () => {
  await settingsService.update(organizationId, { metricsRetentionDays: 7 })
  expect(
    await settingsService.update(organizationId, { metricsRetentionDays: 90 }),
  ).toEqual({ metricsRetentionDays: 90 })
  expect(await settingsService.get(organizationId)).toEqual({
    metricsRetentionDays: 90,
  })
})
