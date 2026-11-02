import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createMember, createOrganization } from '../../../test/fixtures'
import { app } from '../app'
import { db } from '../platform/db'
import { member, session } from '../platform/db/schema'
import { auth } from './better-auth'

// Signs a new user up, returning the cookie their browser would send.
const signUp = async () => {
  const email = `${crypto.randomUUID()}@example.com`
  const { headers, response } = await auth.api.signUpEmail({
    body: { email, password: 'correct horse battery', name: 'Test' },
    returnHeaders: true,
  })
  const cookie = headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('No session cookie')
  return { cookie, userId: response.user.id }
}

const activate = (userId: string, organizationId: string) =>
  db
    .update(session)
    .set({ activeOrganizationId: organizationId })
    .where(eq(session.userId, userId))

const createAgent = (cookie: string) =>
  app.handle(
    new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mac', os: 'darwin', arch: 'arm64' }),
    }),
  )

describe('console session macros', () => {
  test('an owner may manage agents in their organization', async () => {
    const { cookie } = await signUp()
    expect((await createAgent(cookie)).status).toBe(200)
  })

  test("a member's role must grant the permission", async () => {
    const { cookie, userId } = await signUp()
    const { organizationId } = await createOrganization()
    await createMember(organizationId, userId, 'member')
    await activate(userId, organizationId)

    const response = await createAgent(cookie)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' })
  })

  test('a removed member is told so, reading or writing', async () => {
    const { cookie, userId } = await signUp()
    const { organizationId } = await createOrganization()
    await createMember(organizationId, userId, 'owner')
    await activate(userId, organizationId)
    await db.delete(member).where(eq(member.organizationId, organizationId))

    const read = await app.handle(
      new Request('http://localhost/api/agents', { headers: { cookie } }),
    )
    expect(read.status).toBe(403)
    expect(await read.json()).toMatchObject({ code: 'NOT_A_MEMBER' })
    const write = await createAgent(cookie)
    expect(write.status).toBe(403)
    expect(await write.json()).toMatchObject({ code: 'NOT_A_MEMBER' })
  })

  test('signed out, it is a 401', async () => {
    expect((await createAgent('')).status).toBe(401)
  })
})
