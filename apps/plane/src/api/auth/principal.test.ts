import { describe, expect, test } from 'bun:test'
import {
  createMember,
  createOrganization,
  createUser,
} from '../../../test/fixtures'
import { can, memberRole } from './principal'

const manage = { organization: ['update'] } as const

describe('principal', () => {
  test("a member's role is theirs in that organization only", async () => {
    const { organizationId } = await createOrganization()
    const { organizationId: other } = await createOrganization()
    const userId = await createUser()
    await createMember(organizationId, userId, 'admin')

    expect(await memberRole({ userId, organizationId })).toBe('admin')
    expect(await memberRole({ userId, organizationId: other })).toBeUndefined()
  })

  test('owners and admins can manage the organization; members cannot', async () => {
    const { organizationId } = await createOrganization()
    const owner = await createUser()
    const admin = await createUser()
    const plain = await createUser()
    await createMember(organizationId, owner, 'owner')
    await createMember(organizationId, admin, 'admin')
    await createMember(organizationId, plain, 'member')

    expect(await can({ userId: owner, organizationId }, manage)).toBe(true)
    expect(await can({ userId: admin, organizationId }, manage)).toBe(true)
    expect(await can({ userId: plain, organizationId }, manage)).toBe(false)
  })

  test('any of several roles may grant the permission', async () => {
    const { organizationId } = await createOrganization()
    const userId = await createUser()
    await createMember(organizationId, userId, 'member, admin')
    expect(await can({ userId, organizationId }, manage)).toBe(true)
  })

  test('a non-member, or an unknown role, is granted nothing', async () => {
    const { organizationId } = await createOrganization()
    const outsider = await createUser()
    const odd = await createUser()
    await createMember(organizationId, odd, 'superuser')

    expect(await can({ userId: outsider, organizationId }, manage)).toBe(false)
    expect(await can({ userId: odd, organizationId }, manage)).toBe(false)
  })
})
