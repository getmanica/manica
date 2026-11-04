import { describe, expect, test } from 'bun:test'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { createMember, createOrganization } from '../../../test/fixtures'
import { request, signUp } from '../../../test/oauth'
import { bannedNow } from '../auth/bans'
import { auth } from '../auth/better-auth'
import { db } from '../platform/db'
import { member, organization, session, user } from '../platform/db/schema'

// The admin section's API: plane's own `/api/admin/*`, and the admin
// plugin's `/api/auth/admin/*`, both for the plane's admins only.

const promote = (userId: string, role = 'admin') =>
  db.update(user).set({ role }).where(eq(user.id, userId))

const signUpAdmin = async () => {
  const admin = await signUp()
  await promote(admin.userId)
  return admin
}

const listUsers = (cookie: string, query = '') =>
  request(`/api/admin/users${query}`, { headers: { cookie } })

// One of the admin plugin's endpoints, as the console calls it.
const plugin = (cookie: string, path: string, body?: unknown) =>
  request(`/api/auth/admin/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

// Plane's own ban, as the console calls it.
const banUser = (
  cookie: string,
  userId: string,
  body: { reason?: string; expiresIn?: number } = {},
) =>
  request(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const sessionsOf = (userId: string) =>
  db.select().from(session).where(eq(session.userId, userId))

describe('listing users', () => {
  test('signed out, it is a 401', async () => {
    expect((await listUsers('')).status).toBe(401)
  })

  test("a user who isn't an admin is refused, even owning organizations", async () => {
    const { cookie } = await signUp()
    const response = await listUsers(cookie)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' })
  })

  test('an admin lists, filters and pages every user', async () => {
    const { cookie, userId } = await signUpAdmin()
    const other = await signUp()
    const { organizationId } = await createOrganization()
    await createMember(organizationId, other.userId)

    const [own] = await db.select().from(user).where(eq(user.id, userId))
    const [theirs] = await db
      .select()
      .from(user)
      .where(eq(user.id, other.userId))
    if (!own || !theirs) throw new Error('No users')

    const response = await listUsers(
      cookie,
      `?q=${encodeURIComponent(theirs.email)}`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 1,
      // Their personal organization and the one they joined.
      items: [
        { id: other.userId, role: 'user', banned: false, organizations: 2 },
      ],
    })

    const mine = await listUsers(cookie, `?q=${encodeURIComponent(own.email)}`)
    expect(await mine.json()).toMatchObject({
      items: [{ id: userId, role: 'admin' }],
    })

    const page = await listUsers(cookie, '?size=10&page=100000')
    expect(await page.json()).toMatchObject({ items: [] })
  })

  test('an admin among other roles is an admin', async () => {
    const { cookie, userId } = await signUp()
    await promote(userId, 'user,admin')
    expect((await listUsers(cookie)).status).toBe(200)
  })

  test('a demoted admin loses access at once', async () => {
    const { cookie, userId } = await signUpAdmin()
    expect((await listUsers(cookie)).status).toBe(200)
    await promote(userId, 'user')
    expect((await listUsers(cookie)).status).toBe(403)
  })

  test("an expired ban isn't one", async () => {
    const { cookie } = await signUpAdmin()
    const banned = await signUp()
    const lapsed = await signUp()
    await db
      .update(user)
      .set({ banned: true, banReason: 'spam' })
      .where(eq(user.id, banned.userId))
    await db
      .update(user)
      .set({ banned: true, banReason: 'spam', banExpires: new Date(0) })
      .where(eq(user.id, lapsed.userId))

    const response = await listUsers(cookie, '?size=100')
    const { items } = (await response.json()) as {
      items: { id: string; banned: boolean; banReason: string | null }[]
    }
    expect(items.find(({ id }) => id === banned.userId)).toMatchObject({
      banned: true,
      banReason: 'spam',
    })
    expect(items.find(({ id }) => id === lapsed.userId)).toMatchObject({
      banned: false,
      banReason: null,
    })
  })
})

describe("the admin plugin's endpoints", () => {
  test("a user who isn't an admin can't use them", async () => {
    const { cookie } = await signUp()
    const other = await signUp()
    expect((await plugin(cookie, 'list-users')).status).toBe(403)
    for (const [path, body] of [
      ['set-role', { userId: other.userId, role: 'admin' }],
      ['unban-user', { userId: other.userId }],
      ['revoke-user-sessions', { userId: other.userId }],
    ] as const) {
      expect((await plugin(cookie, path, body)).status).toBe(403)
    }
    expect((await banUser(cookie, other.userId)).status).toBe(403)
    expect((await banUser('', other.userId)).status).toBe(401)
    const [theirs] = await db
      .select()
      .from(user)
      .where(eq(user.id, other.userId))
    expect(theirs?.role).toBe('user')
    expect(await sessionsOf(other.userId)).toHaveLength(1)
  })

  test('an admin sets roles, only to known ones', async () => {
    const { cookie } = await signUpAdmin()
    const other = await signUp()
    expect(
      (
        await plugin(cookie, 'set-role', {
          userId: other.userId,
          role: 'admin',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await plugin(cookie, 'set-role', {
          userId: other.userId,
          role: 'owner',
        })
      ).status,
    ).toBe(400)
    const [theirs] = await db
      .select()
      .from(user)
      .where(eq(user.id, other.userId))
    expect(theirs?.role).toBe('admin')
  })

  test('banning signs the user out and keeps them out until unbanned', async () => {
    const { cookie } = await signUpAdmin()
    const other = await signUp()
    const [theirs] = await db
      .select()
      .from(user)
      .where(eq(user.id, other.userId))
    if (!theirs) throw new Error('No user')

    expect(
      (await banUser(cookie, other.userId, { reason: 'spam' })).status,
    ).toBe(200)
    expect(await sessionsOf(other.userId)).toHaveLength(0)
    const signIn = () =>
      request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: theirs.email,
          password: 'correct horse battery',
        }),
      })
    expect((await signIn()).status).toBe(403)

    expect(
      (await plugin(cookie, 'unban-user', { userId: other.userId })).status,
    ).toBe(200)
    expect((await signIn()).status).toBe(200)
  })

  // Signs the user in, banning them (fresh, no expiry) just after the admin
  // plugin read them for its own ban check, before the session is stored.
  // Returns the sign-in's response.
  const signInRacingBan = async (adminCookie: string, userId: string) => {
    const [theirs] = await db.select().from(user).where(eq(user.id, userId))
    if (!theirs) throw new Error('No user')
    let held = false
    const context = await auth.$context
    const findUserById = context.internalAdapter.findUserById
    const { promise: checked, resolve: check } = Promise.withResolvers<void>()
    const { promise: banned, resolve: ban } = Promise.withResolvers<void>()
    context.internalAdapter.findUserById = async (id, ...rest) => {
      const found = await findUserById(id, ...rest)
      if (id === userId && !held) {
        held = true
        check()
        await banned
      }
      return found
    }
    try {
      const signingIn = request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: theirs.email,
          password: 'correct horse battery',
        }),
      })
      // A sign-in that ends without reaching the check fails the test rather
      // than hang it.
      await Promise.race([
        checked,
        signingIn.then((response) => {
          throw new Error(`Signed in without a ban check: ${response.status}`)
        }),
      ])
      expect(
        (await banUser(adminCookie, userId, { reason: 'again' })).status,
      ).toBe(200)
      ban()
      return await signingIn
    } finally {
      ban()
      context.internalAdapter.findUserById = findUserById
    }
  }

  const banOf = async (userId: string) => {
    const [found] = await db
      .select({
        banned: user.banned,
        banReason: user.banReason,
        banExpires: user.banExpires,
      })
      .from(user)
      .where(eq(user.id, userId))
    return found
  }

  test('a sign-in racing a ban leaves no session behind', async () => {
    const admin = await signUpAdmin()
    const victim = await signUp()
    await promote(victim.userId)

    const signedIn = await signInRacingBan(admin.cookie, victim.userId)
    const cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(await sessionsOf(victim.userId)).toHaveLength(0)
    expect((await listUsers(cookie)).status).toBe(401)
    expect(
      (await plugin(cookie, 'unban-user', { userId: victim.userId })).status,
    ).toBe(401)
  })

  test("a sign-in lifting an expired ban can't undo a ban set meanwhile", async () => {
    const admin = await signUpAdmin()
    const victim = await signUp()
    await db.delete(session).where(eq(session.userId, victim.userId))
    await db
      .update(user)
      .set({ banned: true, banReason: 'once', banExpires: new Date(0) })
      .where(eq(user.id, victim.userId))

    const signedIn = await signInRacingBan(admin.cookie, victim.userId)
    expect(signedIn.status).toBe(403)
    expect(await sessionsOf(victim.userId)).toHaveLength(0)
    expect(await banOf(victim.userId)).toEqual({
      banned: true,
      banReason: 'again',
      banExpires: null,
    })
  })

  test('signing in lifts an expired ban', async () => {
    const victim = await signUp()
    const [theirs] = await db
      .select()
      .from(user)
      .where(eq(user.id, victim.userId))
    await db
      .update(user)
      .set({ banned: true, banReason: 'once', banExpires: new Date(0) })
      .where(eq(user.id, victim.userId))

    const signedIn = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: theirs?.email,
        password: 'correct horse battery',
      }),
    })
    expect(signedIn.status).toBe(200)
    expect(await banOf(victim.userId)).toEqual({
      banned: false,
      banReason: null,
      banExpires: null,
    })
  })

  test("an admin can't act as another user", async () => {
    const { cookie } = await signUpAdmin()
    const other = await signUp()
    // Plane bans and removes users itself (see `banning users`, `removing
    // users`).
    for (const path of ['impersonate-user', 'ban-user', 'remove-user']) {
      expect(
        (await plugin(cookie, path, { userId: other.userId })).status,
      ).toBe(404)
    }
    for (const [path, body] of [
      [
        'set-user-password',
        { userId: other.userId, newPassword: 'hunter2hunter2' },
      ],
      [
        'update-user',
        { userId: other.userId, data: { email: 'x@example.com' } },
      ],
      ['update-user', { userId: other.userId, data: { name: 'x' } }],
      [
        'create-user',
        { email: 'new@example.com', password: 'hunter2hunter2', name: 'x' },
      ],
    ] as const) {
      expect((await plugin(cookie, path, body)).status).toBe(403)
    }
  })
})

describe('banning users', () => {
  test('bans for a while, or until unbanned, but not oneself', async () => {
    const admin = await signUpAdmin()
    const other = await signUp()

    const self = await banUser(admin.cookie, admin.userId)
    expect(self.status).toBe(400)
    expect(await self.json()).toMatchObject({ code: 'CANNOT_BAN_SELF' })
    const missing = await banUser(admin.cookie, crypto.randomUUID())
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'USER_NOT_FOUND' })

    for (const expiresIn of [0, 1e13, 1.5]) {
      expect(
        (await banUser(admin.cookie, other.userId, { expiresIn })).status,
      ).toBe(422)
    }
    expect(await sessionsOf(other.userId)).toHaveLength(1)

    const before = Date.now()
    expect(
      (
        await banUser(admin.cookie, other.userId, {
          reason: ' spam ',
          expiresIn: 60,
        })
      ).status,
    ).toBe(200)
    const [ban] = await db
      .select({ reason: user.banReason, expires: user.banExpires })
      .from(user)
      .where(eq(user.id, other.userId))
    expect(ban?.reason).toBe('spam')
    expect(ban?.expires?.getTime()).toBeGreaterThanOrEqual(before + 60_000)
    expect(await sessionsOf(other.userId)).toHaveLength(0)
  })

  test('a failed ban leaves the user as they were, never banned yet signed in', async () => {
    const { cookie } = await signUpAdmin()
    const other = await signUp()
    // Their sessions refuse to go, after the ban was stored.
    const name = `refuse_${other.userId.replaceAll('-', '')}`
    await db.execute(
      sql.raw(`
        create function ${name}() returns trigger language plpgsql as $$
        begin raise exception 'refused'; end $$;
        create trigger ${name} before delete on "session" for each row
        when (old.user_id = '${other.userId}') execute function ${name}();
      `),
    )
    try {
      expect((await banUser(cookie, other.userId)).status).toBe(500)
    } finally {
      await db.execute(
        sql.raw(`drop trigger ${name} on "session"; drop function ${name}();`),
      )
    }
    const [theirs] = await db
      .select({ banned: user.banned })
      .from(user)
      .where(eq(user.id, other.userId))
    expect(theirs?.banned).toBe(false)
    expect(await sessionsOf(other.userId)).toHaveLength(1)
  })
})

describe('removing users', () => {
  const remove = (cookie: string, userId: string) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { cookie },
    })

  // The user's own organizations, and one they share with someone else.
  const leaver = async () => {
    const leaving = await signUp()
    const staying = await signUp()
    const { organizationId: shared } = await createOrganization()
    await createMember(shared, leaving.userId)
    await createMember(shared, staying.userId)
    const [personal] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(
        and(
          eq(member.userId, leaving.userId),
          ne(member.organizationId, shared),
        ),
      )
    if (!personal) throw new Error('No personal organization')
    const organizations = [personal.organizationId, shared]
    const remaining = async () =>
      (
        await db
          .select({ id: organization.id })
          .from(organization)
          .where(inArray(organization.id, organizations))
      )
        .map(({ id }) => id)
        .sort()
    return { ...leaving, personal: personal.organizationId, shared, remaining }
  }

  test('deletes the user and the organizations only they were in', async () => {
    const { cookie } = await signUpAdmin()
    const leaving = await leaver()

    expect((await remove(cookie, leaving.userId)).status).toBe(200)
    expect(await leaving.remaining()).toEqual([leaving.shared])
    expect(
      await db.select().from(user).where(eq(user.id, leaving.userId)),
    ).toHaveLength(0)
    expect(await sessionsOf(leaving.userId)).toHaveLength(0)
  })

  test('only an admin, only someone else, only someone who exists', async () => {
    const admin = await signUpAdmin()
    const { cookie } = await signUp()
    const leaving = await leaver()
    const before = await leaving.remaining()

    expect((await remove('', leaving.userId)).status).toBe(401)
    expect((await remove(cookie, leaving.userId)).status).toBe(403)
    const self = await remove(admin.cookie, admin.userId)
    expect(self.status).toBe(400)
    expect(await self.json()).toMatchObject({ code: 'CANNOT_REMOVE_SELF' })
    const missing = await remove(admin.cookie, crypto.randomUUID())
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'USER_NOT_FOUND' })
    expect(await leaving.remaining()).toEqual(before)
  })

  test('an organization someone joins while the user is removed stays', async () => {
    const { cookie } = await signUpAdmin()
    const leaving = await leaver()
    const joining = await signUp()
    // Only they are in it, but they don't pay for it: it would go with them,
    // as their personal organization does whoever joins it.
    const { organizationId: solo } = await createOrganization()
    await createMember(solo, leaving.userId)

    // The join is under way, not yet committed, as the removal starts.
    const joined = Promise.withResolvers<void>()
    const commit = Promise.withResolvers<void>()
    const joiningTx = db.$client.begin(async (tx) => {
      await tx`insert into member (id, organization_id, user_id, role, created_at)
        values (${crypto.randomUUID()}, ${solo}, ${joining.userId}, 'member', now())`
      joined.resolve()
      await commit.promise
    })
    await joined.promise
    const removing = remove(cookie, leaving.userId)
    try {
      // The removal waits on the join.
      for (let tries = 0; ; tries++) {
        const waiting = await db.$client`select 1 from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`
        if (waiting.length > 0) break
        if (tries > 200) throw new Error('The removal never waited')
        await Bun.sleep(10)
      }
    } finally {
      commit.resolve()
    }
    await joiningTx

    expect((await removing).status).toBe(200)
    expect(await leaving.remaining()).toEqual([leaving.shared])
    expect(
      await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, solo)),
    ).toHaveLength(1)
  })

  test('a failed removal leaves the user and their organizations as they were', async () => {
    const { cookie } = await signUpAdmin()
    const leaving = await leaver()
    const before = await leaving.remaining()
    // The user's own row refuses to go, after their organizations went.
    const name = `refuse_${leaving.userId.replaceAll('-', '')}`
    await db.execute(
      sql.raw(`
        create function ${name}() returns trigger language plpgsql as $$
        begin raise exception 'refused'; end $$;
        create trigger ${name} before delete on "user" for each row
        when (old.id = '${leaving.userId}') execute function ${name}();
      `),
    )
    try {
      expect((await remove(cookie, leaving.userId)).status).toBe(500)
    } finally {
      await db.execute(
        sql.raw(`drop trigger ${name} on "user"; drop function ${name}();`),
      )
    }
    expect(await leaving.remaining()).toEqual(before)
    expect(await sessionsOf(leaving.userId)).toHaveLength(1)
  })
})

test("a ban's expiry is read in UTC, whatever the database's time zone", async () => {
  const { userId } = await signUp()
  await db
    .update(user)
    .set({ banned: true, banExpires: new Date(Date.now() + 30 * 60 * 1000) })
    .where(eq(user.id, userId))
  for (const zone of ['UTC', 'Europe/Paris', 'America/Los_Angeles']) {
    const [row] = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local time zone '${zone}'`))
      return tx
        .select({ banned: bannedNow })
        .from(user)
        .where(eq(user.id, userId))
    })
    expect(row?.banned).toBe(true)
  }
})
