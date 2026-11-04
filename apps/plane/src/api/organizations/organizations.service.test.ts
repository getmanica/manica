import { describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { createOrganization } from '../../../test/fixtures'
import { db } from '../platform/db'
import {
  member,
  organization,
  organizationBilling,
  user,
} from '../platform/db/schema'
import { organizationsService } from './organizations.service'

const createUser = async () => {
  const id = crypto.randomUUID()
  const now = new Date()
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

const join = (userId: string, organizationId: string) =>
  db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: 'owner',
    createdAt: new Date(),
  })

const remaining = async (ids: string[]) =>
  (
    await db
      .select({ id: organization.id })
      .from(organization)
      .where(inArray(organization.id, ids))
  ).map(({ id }) => id)

describe('deleteOwned', () => {
  test("deletes the user's own organizations and keeps shared ones", async () => {
    const leaving = await createUser()
    const staying = await createUser()
    const personal = await organizationsService.createPersonal(leaving)
    const { organizationId: shared } = await createOrganization()
    await join(leaving, shared)
    await join(staying, shared)
    const { organizationId: other } = await createOrganization()
    await join(staying, other)

    await organizationsService.deleteOwned(leaving)

    expect((await remaining([personal, shared, other])).sort()).toEqual(
      [shared, other].sort(),
    )
    const members = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, shared))
    expect(members).toHaveLength(2)
  })

  test('deletes the organizations the user is the billing owner of, even shared', async () => {
    const leaving = await createUser()
    const staying = await createUser()
    const { organizationId: billed } = await createOrganization()
    await db
      .insert(organizationBilling)
      .values({ organizationId: billed, userId: leaving })
    await join(leaving, billed)
    await join(staying, billed)
    const { organizationId: shared } = await createOrganization()
    await db
      .insert(organizationBilling)
      .values({ organizationId: shared, userId: staying })
    await join(leaving, shared)
    await join(staying, shared)

    await organizationsService.deleteOwned(leaving)

    expect(await remaining([billed, shared])).toEqual([shared])
  })
})
