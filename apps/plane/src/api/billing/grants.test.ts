import { setTimeout as sleep } from 'node:timers/promises'
import { eq, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createOrganization, createUser } from '../../../test/fixtures'
import { request, signUp } from '../../../test/oauth'
import { agentsService } from '../agents/agents.service'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import {
  agent,
  organizationBilling,
  plan,
  planGrant,
  subscription,
  user,
} from '../platform/db/schema'
import { env } from '../platform/env'
import { billingService } from './billing.service'
import {
  BillingDisabledError,
  GrantForSubscriberError,
  GrantNotFoundError,
  GrantPlanInvalidError,
  PlanInUseError,
  PlanNotFoundError,
} from './errors'
import { grantsService } from './grants.service'
import { grantHolds, limitsService } from './limits'
import { plansService } from './plans.service'
import { stripeApi } from './stripe'

const saved = { stripe: env.stripe, client: stripeApi.client }
beforeAll(() => {
  env.stripe = { apiKey: 'sk_test', webhookSecret: 'whsec_test' }
})
afterAll(async () => {
  await plansService.limitsApplied()
  env.stripe = saved.stripe
  stripeApi.client = saved.client
})

// A Stripe client holding the customer's checkouts. `onList` runs when their
// subscriptions are listed, to open a checkout meanwhile, and returns those
// subscriptions (none unless it returns an array).
const fakeStripe = (onList?: () => unknown) => {
  const sessions: { id: string; status: 'open' | 'expired' | 'complete' }[] = []
  stripeApi.client = {
    subscriptions: {
      list: async function* () {
        const listed = onList?.()
        yield* Array.isArray(listed) ? listed : []
      },
    },
    checkout: {
      sessions: {
        list: async function* ({ status }: { status?: string }) {
          yield* sessions.filter((found) => !status || found.status === status)
        },
        // As Stripe does, only while open.
        expire: async (id: string) => {
          const found = sessions.find((session) => session.id === id)
          if (found?.status !== 'open') throw new Error('Not open')
          found.status = 'expired'
          return {}
        },
        retrieve: async (id: string) =>
          sessions.find((session) => session.id === id),
      },
    },
  } as unknown as Stripe
  const open = () => {
    const id = `cs_${crypto.randomUUID()}`
    sessions.push({ id, status: 'open' })
    return id
  }
  const isOpen = (id: string) =>
    sessions.find((session) => session.id === id)?.status === 'open'
  // Closes the checkout behind the caller's back: expired by another request,
  // or paid.
  const closeElsewhere = (id: string, status: 'expired' | 'complete') => {
    const found = sessions.find((session) => session.id === id)
    if (found) found.status = status
  }
  // Each checkout listed is closed as the caller gets to expiring it.
  const closeOnExpire = (status: 'expired' | 'complete') => {
    const client = stripeApi.client
    const original = client?.checkout.sessions.expire
    if (!client || !original) throw new Error('No fake')
    client.checkout.sessions.expire = (async (id: string) => {
      closeElsewhere(id, status)
      return original(id)
    }) as typeof original
  }
  return { open, isOpen, closeOnExpire }
}

// A user who has been to checkout: a Stripe customer.
const customer = async (userId: string) => {
  await db
    .update(user)
    .set({ stripeCustomerId: `cus_${crypto.randomUUID()}` })
    .where(eq(user.id, userId))
}

const createPlan = async (maxOrganizations: number | null = null) => {
  const created = await plansService.create({
    name: `plan-${crypto.randomUUID()}`,
    monthlyPriceId: `price_${crypto.randomUUID()}`,
    maxOrganizations,
  })
  if (created instanceof Error) throw created
  return created
}

const defaultPlan = async () => {
  const [found] = await db.select().from(plan).where(eq(plan.isDefault, true))
  if (!found) throw new Error('No default plan')
  return found
}

const subscribe = (userId: string, planId: string, status = 'active') =>
  db.insert(subscription).values({
    id: crypto.randomUUID(),
    plan: planId,
    referenceId: userId,
    status,
    periodStart: new Date(),
  })

const newUser = async () => {
  const userId = await createUser()
  await organizationsService.createPersonal(userId)
  return userId
}

describe('granting a plan', () => {
  test('puts the user on it, and revoking takes them back', async () => {
    const admin = await createUser()
    const userId = await newUser()
    const granted = await createPlan()

    const result = await grantsService.grant(admin, userId, {
      planId: granted.id,
      reason: '  partner  ',
    })
    expect(result).toMatchObject({ planId: granted.id, expiresAt: null })
    expect((await limitsService.planFor(userId))?.id).toBe(granted.id)
    expect(await grantsService.current(userId)).toMatchObject({
      planId: granted.id,
      planName: granted.name,
      reason: 'partner',
    })
    expect(await billingService.summary(userId)).toMatchObject({
      plan: { id: granted.id },
      subscription: null,
      grant: { planId: granted.id, expiresAt: null },
    })

    expect(await grantsService.revoke(userId)).toBeUndefined()
    expect((await limitsService.planFor(userId))?.id).toBe(
      (await defaultPlan()).id,
    )
    expect(await grantsService.revoke(userId)).toBeInstanceOf(
      GrantNotFoundError,
    )
  })

  test('applies its limits at once, both ways', async () => {
    const admin = await createUser()
    const userId = await newUser()
    const tight = await createPlan(1)
    const roomy = await createPlan(null)
    const { organizationId } = await createOrganization()
    await organizationsService.attachBillingOwner(organizationId, userId)
    const disabledAt = async () =>
      (
        await db
          .select({ disabledAt: organizationBilling.disabledAt })
          .from(organizationBilling)
          .where(eq(organizationBilling.organizationId, organizationId))
      )[0]?.disabledAt

    await grantsService.grant(admin, userId, { planId: tight.id })
    expect(await disabledAt()).not.toBeNull()
    // Granting again replaces the grant.
    await grantsService.grant(admin, userId, { planId: roomy.id })
    expect(await disabledAt()).toBeNull()
    expect((await grantsService.current(userId))?.planId).toBe(roomy.id)
  })

  test('lapses once expired', async () => {
    const admin = await createUser()
    const userId = await newUser()
    const granted = await createPlan()
    await grantsService.grant(admin, userId, {
      planId: granted.id,
      expiresIn: 60,
    })
    expect((await limitsService.planFor(userId))?.id).toBe(granted.id)

    await db
      .update(planGrant)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(planGrant.userId, userId))
    expect((await limitsService.planFor(userId))?.id).toBe(
      (await defaultPlan()).id,
    )
    expect(await grantsService.current(userId)).toBeUndefined()
    expect(await billingService.summary(userId)).toMatchObject({ grant: null })
  })

  test('is refused to users who pay, or still owe', async () => {
    const admin = await createUser()
    const granted = await createPlan()
    for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
      const userId = await newUser()
      await subscribe(userId, granted.id, status)
      expect(
        await grantsService.grant(admin, userId, { planId: granted.id }),
      ).toBeInstanceOf(GrantForSubscriberError)
    }
    // A subscription that's over doesn't count.
    const lapsed = await newUser()
    await subscribe(lapsed, granted.id, 'canceled')
    expect(
      await grantsService.grant(admin, lapsed, { planId: granted.id }),
    ).not.toBeInstanceOf(Error)
  })

  test('is refused for the default plan, a missing one, or billing off', async () => {
    const admin = await createUser()
    const userId = await newUser()
    expect(
      await grantsService.grant(admin, userId, {
        planId: (await defaultPlan()).id,
      }),
    ).toBeInstanceOf(GrantPlanInvalidError)
    expect(
      await grantsService.grant(admin, userId, { planId: 'missing' }),
    ).toBeInstanceOf(PlanNotFoundError)

    env.stripe = undefined
    try {
      expect(
        await grantsService.grant(admin, userId, {
          planId: (await createPlan()).id,
        }),
      ).toBeInstanceOf(BillingDisabledError)
    } finally {
      env.stripe = { apiKey: 'sk_test', webhookSecret: 'whsec_test' }
    }
  })

  test('keeps its plan from being deleted, but not disabled', async () => {
    const admin = await createUser()
    const userId = await newUser()
    const granted = await createPlan()
    await grantsService.grant(admin, userId, { planId: granted.id })

    expect(await plansService.delete(granted.id)).toBeInstanceOf(PlanInUseError)
    await plansService.update(granted.id, { enabled: false })
    expect((await limitsService.planFor(userId))?.id).toBe(granted.id)

    await grantsService.revoke(userId)
    expect(await plansService.delete(granted.id)).toBeUndefined()
  })

  test("expires on time, whatever the database's time zone", async () => {
    const admin = await createUser()
    const userId = await newUser()
    await grantsService.grant(admin, userId, {
      planId: (await createPlan()).id,
      expiresIn: 30 * 60,
    })
    for (const zone of ['UTC', 'Europe/Paris', 'America/Los_Angeles']) {
      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local time zone '${zone}'`))
        return tx
          .select({ userId: planGrant.userId })
          .from(planGrant)
          .where(grantHolds)
      })
      expect(rows.map((row) => row.userId)).toContain(userId)
    }
  })

  test('lets its plan be deleted once expired, taking it along', async () => {
    const admin = await createUser()
    const userId = await newUser()
    const granted = await createPlan()
    await grantsService.grant(admin, userId, { planId: granted.id })
    await db
      .update(planGrant)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(planGrant.userId, userId))

    expect(await plansService.delete(granted.id)).toBeUndefined()
    expect(
      await db.select().from(planGrant).where(eq(planGrant.userId, userId)),
    ).toEqual([])
  })

  test("isn't lost to its plan being deleted meanwhile", async () => {
    const admin = await createUser()
    const userId = await newUser()
    const granted = await createPlan()
    await grantsService.grant(admin, userId, { planId: granted.id })
    await db
      .update(planGrant)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(planGrant.userId, userId))

    // Deleting the plan, as `plansService.delete` does: locked, its expired
    // grants and then it deleted. Renewing the grant meanwhile waits for it.
    let renewal: ReturnType<typeof grantsService.grant> | undefined
    await db.transaction(async (tx) => {
      await tx
        .select({ id: plan.id })
        .from(plan)
        .where(eq(plan.id, granted.id))
        .for('update')
      renewal = grantsService.grant(admin, userId, { planId: granted.id })
      // Until the renewal waits on the plan's lock.
      for (let tries = 0; ; tries++) {
        const [waiting] = await db.execute<{ count: number }>(
          sql`select count(*)::int as count from pg_locks where not granted`,
        )
        if (waiting?.count) break
        if (tries > 200) throw new Error('The renewal never waited')
        await sleep(10)
      }
      await tx.delete(planGrant).where(eq(planGrant.planId, granted.id))
      await tx.delete(plan).where(eq(plan.id, granted.id))
    })
    expect(await renewal).toBeInstanceOf(PlanNotFoundError)
  })

  test('expires checkouts left open, and one opened while granting', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    let opened: string | undefined
    const stripe = fakeStripe(() => {
      opened ??= stripe.open()
    })
    try {
      const left = stripe.open()
      await grantsService.grant(admin, userId, {
        planId: (await createPlan()).id,
      })
      expect(stripe.isOpen(left)).toBe(false)
      expect(opened && stripe.isOpen(opened)).toBe(false)
    } finally {
      stripeApi.client = saved.client
    }
  })

  test('expires a checkout opened just after, once it sees the grant', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    const stripe = fakeStripe()
    try {
      const before = stripe.open()
      await grantsService.expireCheckoutsIfGranted(userId)
      // Not granted: checkouts are left alone.
      expect(stripe.isOpen(before)).toBe(true)

      await grantsService.grant(admin, userId, {
        planId: (await createPlan()).id,
      })
      const after = stripe.open()
      await grantsService.expireCheckoutsIfGranted(userId)
      expect(stripe.isOpen(after)).toBe(false)
    } finally {
      stripeApi.client = saved.client
    }
  })

  test('copes with a checkout expired meanwhile by another request', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    const stripe = fakeStripe()
    // Listed open, then expired by the checkout's own request before the
    // grant gets to it.
    const raced = stripe.open()
    stripe.closeOnExpire('expired')
    try {
      const tight = await createPlan(0)
      const { organizationId } = await createOrganization()
      await organizationsService.attachBillingOwner(organizationId, userId)
      expect(
        await grantsService.grant(admin, userId, { planId: tight.id }),
      ).not.toBeInstanceOf(Error)
      expect(stripe.isOpen(raced)).toBe(false)
      expect(await grantsService.current(userId)).toBeDefined()
      // Its limits were applied.
      const [row] = await db
        .select({ disabledAt: organizationBilling.disabledAt })
        .from(organizationBilling)
        .where(eq(organizationBilling.organizationId, organizationId))
      expect(row?.disabledAt).not.toBeNull()
    } finally {
      stripeApi.client = saved.client
    }
  })

  test('fails on a checkout paid meanwhile', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    const stripe = fakeStripe()
    stripe.open()
    stripe.closeOnExpire('complete')
    try {
      await expect(
        grantsService.grant(admin, userId, {
          planId: (await createPlan()).id,
        }),
      ).rejects.toThrow('Not open')
      expect(await grantsService.current(userId)).toBeUndefined()
    } finally {
      stripeApi.client = saved.client
    }
  })

  test('is undone for a checkout paid while granting', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    const tight = await createPlan(0)
    // Stripe has no subscription at the first check, then one: a checkout
    // opened and paid in between.
    let lists = 0
    fakeStripe(() =>
      lists++ === 0 ? [] : [{ id: 'sub_paid', status: 'active' }],
    )
    try {
      expect(
        await grantsService.grant(admin, userId, { planId: tight.id }),
      ).toBeInstanceOf(GrantForSubscriberError)
      expect(
        await db.select().from(planGrant).where(eq(planGrant.userId, userId)),
      ).toEqual([])
      // Back on the default plan, not the undone grant's.
      expect((await limitsService.planFor(userId))?.id).toBe(
        (await defaultPlan()).id,
      )
    } finally {
      stripeApi.client = saved.client
    }
  })

  test('is undone for a checkout paid as the last pass expires it', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    // Opened as the user's subscriptions are first checked, after the first
    // pass, and paid as the last pass gets to expiring it.
    let opened: string | undefined
    const stripe = fakeStripe(() => {
      opened ??= stripe.open()
    })
    stripe.closeOnExpire('complete')
    try {
      await expect(
        grantsService.grant(admin, userId, {
          planId: (await createPlan()).id,
        }),
      ).rejects.toThrow('Not open')
      expect(opened).toBeDefined()
      expect(
        await db.select().from(planGrant).where(eq(planGrant.userId, userId)),
      ).toEqual([])
      expect((await limitsService.planFor(userId))?.id).toBe(
        (await defaultPlan()).id,
      )
    } finally {
      stripeApi.client = saved.client
    }
  })

  test('puts back the grant it replaced when Stripe fails', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    const kept = await createPlan()
    await grantsService.grant(admin, userId, {
      planId: kept.id,
      reason: 'first',
    })
    // The last pass's listing fails: Stripe can't be reached.
    let lists = 0
    fakeStripe()
    const client = stripeApi.client
    if (!client) throw new Error('No fake')
    const list = client.checkout.sessions.list
    client.checkout.sessions.list = ((...args: Parameters<typeof list>) => {
      if (lists++ === 1) throw new Error('Stripe is down')
      return list(...args)
    }) as typeof list
    try {
      await expect(
        grantsService.grant(admin, userId, {
          planId: (await createPlan()).id,
        }),
      ).rejects.toThrow('Stripe is down')
      expect(await grantsService.current(userId)).toMatchObject({
        planId: kept.id,
        reason: 'first',
      })
      expect((await limitsService.planFor(userId))?.id).toBe(kept.id)
    } finally {
      stripeApi.client = saved.client
    }
  })

  test("leaves the user's choice of enabled resources when it fails", async () => {
    const admin = await createUser()
    const userId = await newUser()
    await customer(userId)
    const personal = await organizationsService.defaultFor(userId)
    if (!personal) throw new Error('No personal organization')
    await grantsService.grant(admin, userId, {
      planId: (await createPlan()).id,
    })
    const created = []
    for (const name of ['older', 'newer']) {
      const found = await agentsService.create({
        name: `${name}-${crypto.randomUUID()}`,
        os: 'linux',
        arch: 'x86_64',
        organizationId: personal,
        userId,
      })
      if (found instanceof Error) throw found
      created.push(found.agent.id)
    }
    const [older, newer] = created as [string, string]
    // One agent allowed: the newer is disabled, then kept instead.
    const one = await createPlan(null)
    await db.update(plan).set({ maxAgents: 1 }).where(eq(plan.id, one.id))
    await grantsService.grant(admin, userId, { planId: one.id })
    expect(
      await limitsService.swap(userId, 'agents', {
        enable: newer,
        disable: older,
      }),
    ).toBeUndefined()

    // Granting a plan with none fails as Stripe can't be reached.
    const none = await createPlan(null)
    await db.update(plan).set({ maxAgents: 0 }).where(eq(plan.id, none.id))
    let lists = 0
    fakeStripe()
    const client = stripeApi.client
    if (!client) throw new Error('No fake')
    const list = client.checkout.sessions.list
    client.checkout.sessions.list = ((...args: Parameters<typeof list>) => {
      if (lists++ === 1) throw new Error('Stripe is down')
      return list(...args)
    }) as typeof list
    try {
      await expect(
        grantsService.grant(admin, userId, { planId: none.id }),
      ).rejects.toThrow('Stripe is down')
    } finally {
      stripeApi.client = saved.client
    }
    const enabled = await db
      .select({ id: agent.id, disabledAt: agent.disabledAt })
      .from(agent)
      .where(eq(agent.organizationId, personal))
    expect(enabled.find(({ id }) => id === newer)?.disabledAt).toBeNull()
    expect(enabled.find(({ id }) => id === older)?.disabledAt).not.toBeNull()
  })

  test('goes with the user', async () => {
    const admin = await createUser()
    const userId = await newUser()
    await grantsService.grant(admin, userId, {
      planId: (await createPlan()).id,
    })
    await db.delete(user).where(eq(user.id, userId))
    expect(
      await db.select().from(planGrant).where(eq(planGrant.userId, userId)),
    ).toEqual([])
  })
})

describe("the admin's grant endpoints", () => {
  const grant = (cookie: string, userId: string, body: unknown) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/grant`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const revoke = (cookie: string, userId: string) =>
    request(`/api/admin/users/${encodeURIComponent(userId)}/grant`, {
      method: 'DELETE',
      headers: { cookie },
    })

  test('are for admins only', async () => {
    const { cookie } = await signUp()
    const other = await newUser()
    const planId = (await createPlan()).id
    expect((await grant(cookie, other, { planId })).status).toBe(403)
    expect((await revoke(cookie, other)).status).toBe(403)
  })

  test('grant, list and revoke', async () => {
    const admin = await signUp()
    await db
      .update(user)
      .set({ role: 'admin' })
      .where(eq(user.id, admin.userId))
    const target = await signUp()
    const granted = await createPlan()

    const response = await grant(admin.cookie, target.userId, {
      planId: granted.id,
      expiresIn: 3600,
    })
    expect(response.status).toBe(200)
    const [row] = await db
      .select()
      .from(planGrant)
      .where(eq(planGrant.userId, target.userId))
    expect(row).toMatchObject({ planId: granted.id, grantedBy: admin.userId })

    const [found] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, target.userId))
    const listed = await request(
      `/api/admin/users?q=${encodeURIComponent(found?.email ?? '')}`,
      { headers: { cookie: admin.cookie } },
    )
    expect(await listed.json()).toMatchObject({
      items: [{ id: target.userId, grant: { planId: granted.id } }],
    })

    expect((await revoke(admin.cookie, target.userId)).status).toBe(204)
    expect((await revoke(admin.cookie, target.userId)).status).toBe(404)
    expect(
      (await grant(admin.cookie, 'missing', { planId: granted.id })).status,
    ).toBe(404)
  })

  test('refuse a paying user', async () => {
    const admin = await signUp()
    await db
      .update(user)
      .set({ role: 'admin' })
      .where(eq(user.id, admin.userId))
    const target = await newUser()
    const granted = await createPlan()
    await subscribe(target, granted.id)
    const response = await grant(admin.cookie, target, { planId: granted.id })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'GRANT_FOR_SUBSCRIBER',
    })
  })
})
