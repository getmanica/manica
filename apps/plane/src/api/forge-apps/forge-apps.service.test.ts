import { expect, test } from 'vitest'
import { createOrganization } from '../../../test/fixtures'
import { ForgeAppNotFoundError } from './errors'
import { forgeAppsService } from './forge-apps.service'

test('list pages, sorts and filters the organization’s apps', async () => {
  const { organizationId, app } = await createOrganization()
  const other = await createOrganization()

  expect(await forgeAppsService.list(organizationId)).toMatchObject({
    total: 1,
    items: [{ id: app.id, name: 'Manica' }],
  })
  expect(
    await forgeAppsService.list(organizationId, { sort: 'name', dir: 'asc' }),
  ).toMatchObject({ total: 1 })
  expect(
    await forgeAppsService.list(organizationId, { q: 'acme' }),
  ).toMatchObject({ total: 1 })
  expect(
    await forgeAppsService.list(organizationId, { q: 'GitHub' }),
  ).toMatchObject({ total: 1 })
  expect(await forgeAppsService.list(organizationId, { q: 'gitlab' })).toEqual({
    items: [],
    total: 0,
  })
  expect(
    await forgeAppsService.list(organizationId, { size: 10, page: 2 }),
  ).toEqual({ items: [], total: 1 })
  expect(await forgeAppsService.list(other.organizationId)).toMatchObject({
    total: 1,
    items: [{ id: other.app.id }],
  })
})

test('get finds only the organization’s own app', async () => {
  const { organizationId, app } = await createOrganization()
  const other = await createOrganization()
  expect(await forgeAppsService.get(organizationId, app.id)).toMatchObject({
    id: app.id,
  })
  expect(
    await forgeAppsService.get(other.organizationId, app.id),
  ).toBeInstanceOf(ForgeAppNotFoundError)
})
