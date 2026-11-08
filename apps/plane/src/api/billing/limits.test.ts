import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  createAgent,
  createJob,
  createOrganization,
  createUser,
} from '../../../test/fixtures'
import { fakeForge, forgesWith } from '../../../test/forge'
import { agentsService } from '../agents/agents.service'
import { organizationsService } from '../organizations/organizations.service'
import { db } from '../platform/db'
import {
  agent,
  forgeApp,
  organizationBilling,
  plan,
  subscription,
} from '../platform/db/schema'
import { env } from '../platform/env'
import { createRunnersService } from '../runners/runners.service'
import {
  DefaultPlanRequiredError,
  OrganizationDisabledError,
  PlanInUseError,
  PlanLimitReachedError,
  PlanOrderInvalidError,
  PlanPricesInvalidError,
  SwapInvalidError,
} from './errors'
import { limitsService } from './limits'
import { plansService } from './plans.service'

const stripe = env.stripe
beforeAll(() => {
  env.stripe = { apiKey: 'sk_test', webhookSecret: 'whsec_test' }
})
afterAll(async () => {
  await plansService.limitsApplied()
  env.stripe = stripe
})

// A plan of its own, so tests don't share limits.
const createPlan = async (
  limits: Partial<
    Pick<
      typeof plan.$inferInsert,
      'maxOrganizations' | 'maxAgents' | 'maxForgeApps'
    >
  >,
) => {
  const created = await plansService.create({
    name: `plan-${crypto.randomUUID()}`,
    monthlyPriceId: `price_${crypto.randomUUID()}`,
    ...limits,
  })
  if (created instanceof Error) throw created
  return created
}

const subscribe = async (userId: string, planId: string, status = 'active') => {
  const id = crypto.randomUUID()
  await db.insert(subscription).values({
    id,
    plan: planId,
    referenceId: userId,
    status,
    periodStart: new Date(),
  })
  return id
}

// A user with their personal organization, on a plan of their own.
const subscribedUser = async (
  limits: Parameters<typeof createPlan>[0],
  status = 'active',
) => {
  const userId = await createUser()
  const personal = await organizationsService.createPersonal(userId)
  const found = await createPlan(limits)
  const subscriptionId = await subscribe(userId, found.id, status)
  return { userId, personal, plan: found, subscriptionId }
}

// Another organization billed to the user (the fixture adds a forge app).
const billedOrganization = async (userId: string) => {
  const { organizationId, app } = await createOrganization()
  await organizationsService.attachBillingOwner(organizationId, userId)
  return { organizationId, app }
}

const newAgent = (organizationId: string, userId: string) =>
  agentsService.create({
    name: `agent-${crypto.randomUUID()}`,
    os: 'linux',
    arch: 'x86_64',
    organizationId,
    userId,
  })

const disabledAgents = async (ids: string[]) =>
  (
    await db
      .select({ id: agent.id, disabledAt: agent.disabledAt })
      .from(agent)
      .where(inArray(agent.id, ids))
  )
    .filter((row) => row.disabledAt)
    .map(({ id }) => id)

describe('planFor', () => {
  test('is the subscribed plan while Stripe bills or retries it', async () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      const { userId, plan: subscribed } = await subscribedUser({}, status)
      expect((await limitsService.planFor(userId))?.id).toBe(subscribed.id)
    }
  })

  test('falls back to the default plan otherwise', async () => {
    const { userId } = await subscribedUser({}, 'canceled')
    expect((await limitsService.planFor(userId))?.isDefault).toBe(true)
  })

  test('is none with billing off, so nothing is limited', async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 0 })
    env.stripe = undefined
    try {
      expect(await limitsService.planFor(userId)).toBeUndefined()
      const created = await newAgent(personal, userId)
      expect(created).not.toBeInstanceOf(Error)
    } finally {
      env.stripe = { apiKey: 'sk_test', webhookSecret: 'whsec_test' }
    }
  })
})

describe('creating past a limit', () => {
  test('refuses agents past the plan, counted across billed organizations', async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 2 })
    const { organizationId } = await billedOrganization(userId)
    expect(await newAgent(personal, userId)).not.toBeInstanceOf(Error)
    expect(await newAgent(organizationId, userId)).not.toBeInstanceOf(Error)

    const refused = await newAgent(organizationId, userId)
    expect(refused).toBeInstanceOf(PlanLimitReachedError)
  })

  test('counts against the billing owner, whoever creates it', async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 1 })
    const member = await createUser()
    expect(await newAgent(personal, member)).not.toBeInstanceOf(Error)
    expect(await newAgent(personal, member)).toBeInstanceOf(
      PlanLimitReachedError,
    )
    expect((await limitsService.usage(userId)).agents).toEqual({
      used: 1,
      enabled: 1,
      max: 1,
    })
  })

  test('refuses organizations past the plan, the personal one included', async () => {
    const { userId } = await subscribedUser({ maxOrganizations: 1 })
    const refused = await limitsService.withRoom(
      userId,
      'organizations',
      async () => 'created',
    )
    expect(refused).toBeInstanceOf(PlanLimitReachedError)
  })
})

describe('reconcile', () => {
  test('disables the newest past the limit, and enables them again on upgrade', async () => {
    const { userId, personal, subscriptionId } = await subscribedUser({})
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      ids.push(
        (await createAgent(personal, { createdAt: new Date(Date.now() + i) }))
          .id,
      )
    }
    const small = await createPlan({ maxAgents: 1 })
    await db
      .update(subscription)
      .set({ plan: small.id })
      .where(eq(subscription.id, subscriptionId))

    await limitsService.reconcile(userId)
    expect((await disabledAgents(ids)).sort()).toEqual(ids.slice(1).sort())

    const bigger = await createPlan({ maxAgents: 2 })
    await db
      .update(subscription)
      .set({ plan: bigger.id })
      .where(eq(subscription.id, subscriptionId))
    await limitsService.reconcile(userId)
    expect(await disabledAgents(ids)).toEqual([ids[2] as string])
  })

  test('never disables the personal organization', async () => {
    const { userId, personal } = await subscribedUser({ maxOrganizations: 0 })
    const { organizationId } = await billedOrganization(userId)

    await limitsService.reconcile(userId)

    const rows = await db
      .select()
      .from(organizationBilling)
      .where(eq(organizationBilling.userId, userId))
    const disabled = rows.filter((row) => row.disabledAt)
    expect(disabled.map((row) => row.organizationId)).toEqual([organizationId])
    expect(
      rows.find((row) => row.organizationId === personal)?.disabledAt,
    ).toBeNull()
  })

  test("counts the personal organization, and disables what's in it", async () => {
    const { userId, personal } = await subscribedUser({
      maxOrganizations: 1,
      maxAgents: 0,
      maxForgeApps: 0,
    })
    const inPersonal = await createAgent(personal)
    const [app] = await db
      .insert(forgeApp)
      .values({
        id: crypto.randomUUID(),
        forge: 'github',
        externalId: crypto.randomUUID(),
        slug: 'manica',
        name: 'Manica',
        url: 'https://github.com/apps/manica',
        owner: 'acme',
        secrets: 'unused',
        organizationId: personal,
      })
      .returning()
    if (!app) throw new Error('No forge app created')

    // The personal organization takes the one organization allowed.
    expect(
      await limitsService.withRoom(userId, 'organizations', async () => 'ok'),
    ).toBeInstanceOf(PlanLimitReachedError)

    await limitsService.reconcile(userId)
    expect(await disabledAgents([inPersonal.id])).toEqual([inPersonal.id])
    const [stored] = await db
      .select({ disabledAt: forgeApp.disabledAt })
      .from(forgeApp)
      .where(eq(forgeApp.id, app.id))
    expect(stored?.disabledAt).toBeInstanceOf(Date)
    const [org] = await db
      .select({ disabledAt: organizationBilling.disabledAt })
      .from(organizationBilling)
      .where(eq(organizationBilling.organizationId, personal))
    expect(org?.disabledAt).toBeNull()
  })

  test('keeps a swap', async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 1 })
    const older = await createAgent(personal)
    const newer = await createAgent(personal, {
      createdAt: new Date(Date.now() + 1000),
    })
    await limitsService.reconcile(userId)
    expect(await disabledAgents([older.id, newer.id])).toEqual([newer.id])

    const error = await limitsService.swap(userId, 'agents', {
      enable: newer.id,
      disable: older.id,
    })
    expect(error).toBeUndefined()
    await limitsService.reconcile(userId)
    expect(await disabledAgents([older.id, newer.id])).toEqual([older.id])
  })

  test('deleting one makes room for a disabled one at once', async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 1 })
    const kept = await createAgent(personal)
    const waiting = await createAgent(personal, {
      createdAt: new Date(Date.now() + 1000),
    })
    await limitsService.reconcile(userId)
    expect(await disabledAgents([kept.id, waiting.id])).toEqual([waiting.id])

    expect(await agentsService.delete(personal, kept.id)).toBeUndefined()
    expect(await disabledAgents([waiting.id])).toEqual([])
  })

  test('refuses enabling an agent whose organization is disabled', async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 1 })
    const working = await createAgent(personal)
    const { organizationId } = await billedOrganization(userId)
    const stuck = await createAgent(organizationId, { disabledAt: new Date() })
    await db
      .update(organizationBilling)
      .set({ disabledAt: new Date() })
      .where(eq(organizationBilling.organizationId, organizationId))

    expect(
      await limitsService.swap(userId, 'agents', {
        enable: stuck.id,
        disable: working.id,
      }),
    ).toBeInstanceOf(OrganizationDisabledError)
    expect(await disabledAgents([working.id])).toEqual([])
  })

  test("refuses swapping what isn't the user's, or the wrong way round", async () => {
    const { userId, personal } = await subscribedUser({ maxAgents: 1 })
    const mine = await createAgent(personal)
    const other = await subscribedUser({})
    const theirs = await createAgent(other.personal, {
      disabledAt: new Date(),
    })
    expect(
      await limitsService.swap(userId, 'agents', {
        enable: theirs.id,
        disable: mine.id,
      }),
    ).toBeInstanceOf(SwapInvalidError)
    expect(
      await limitsService.swap(userId, 'organizations', {
        enable: personal,
        disable: personal,
      }),
    ).toBeInstanceOf(SwapInvalidError)
  })

  test('enables everything with billing off', async () => {
    const { personal } = await subscribedUser({})
    const disabled = await createAgent(personal, { disabledAt: new Date() })
    env.stripe = undefined
    try {
      await limitsService.reconcileAll()
    } finally {
      env.stripe = { apiKey: 'sk_test', webhookSecret: 'whsec_test' }
    }
    expect(await disabledAgents([disabled.id])).toEqual([])
  })
})

describe('disabled', () => {
  test("lists an organization's agents disabled with it", async () => {
    const { userId } = await subscribedUser({})
    const { organizationId } = await billedOrganization(userId)
    await createAgent(organizationId)
    await db
      .update(organizationBilling)
      .set({ disabledAt: new Date() })
      .where(eq(organizationBilling.organizationId, organizationId))

    const { items } = await agentsService.list(organizationId)
    expect(items[0]?.disabledAt).toBeInstanceOf(Date)
  })

  test('organizations are read-only, but their agents can be deleted', async () => {
    const { userId } = await subscribedUser({})
    const { organizationId } = await billedOrganization(userId)
    const existing = await createAgent(organizationId)
    await db
      .update(organizationBilling)
      .set({ disabledAt: new Date() })
      .where(eq(organizationBilling.organizationId, organizationId))

    expect(await newAgent(organizationId, userId)).toBeInstanceOf(
      OrganizationDisabledError,
    )
    expect(
      await agentsService.update(organizationId, existing.id, { slots: 2 }),
    ).toBeInstanceOf(OrganizationDisabledError)
    expect(
      await agentsService.delete(organizationId, existing.id),
    ).toBeUndefined()
  })

  test("agents and forge apps' jobs aren't handed out", async () => {
    const { userId } = await subscribedUser({})
    const { organizationId, app } = await billedOrganization(userId)
    await createJob(organizationId, app.id)
    const idle = await createAgent(organizationId, { disabledAt: new Date() })
    const runners = createRunnersService(
      forgesWith(
        fakeForge({
          createRunner: async () => ({ externalRunnerId: '1', config: 'jit' }),
        }),
      ),
      {
        for: async () => ({
          version: '2.338.2',
          url: 'https://example.com/runner.tar.gz',
          sha256: 'a'.repeat(64),
        }),
      },
    )
    const poll = (agentId: string) =>
      runners.poll(agentId, { accepting: true, runners: [] })

    // Disabled agent: nothing, whatever the job.
    expect((await poll(idle.id)).start).toEqual([])

    // Enabled agent, disabled forge app: its jobs wait.
    const ready = await createAgent(organizationId)
    await db
      .update(forgeApp)
      .set({ disabledAt: new Date() })
      .where(eq(forgeApp.id, app.id))
    expect((await poll(ready.id)).start).toEqual([])

    // Both enabled: it's handed out.
    await db
      .update(forgeApp)
      .set({ disabledAt: null })
      .where(eq(forgeApp.id, app.id))
    expect((await poll(ready.id)).start).toHaveLength(1)
  })
})

describe('plans', () => {
  test("can't delete a plan someone is subscribed to, nor the default", async () => {
    const { plan: held } = await subscribedUser({})
    expect(await plansService.delete(held.id)).toBeInstanceOf(PlanInUseError)
    const [fallback] = await db
      .select()
      .from(plan)
      .where(eq(plan.isDefault, true))
    if (!fallback) throw new Error('No default plan')
    expect(await plansService.delete(fallback.id)).toBeInstanceOf(
      DefaultPlanRequiredError,
    )
  })

  test('paid plans need a monthly price', async () => {
    const created = await plansService.create({ name: crypto.randomUUID() })
    expect(created).toBeInstanceOf(PlanPricesInvalidError)
  })

  test('the Stripe plugin sees priced plans by id, disabled ones too', async () => {
    const disabled = await createPlan({})
    await plansService.update(disabled.id, { enabled: false })
    const plans = await plansService.forStripe()
    expect(plans.find((found) => found.name === disabled.id)).toMatchObject({
      priceId: disabled.monthlyPriceId,
    })
    const available = await plansService.available()
    expect(available.some((found) => found.id === disabled.id)).toBe(false)
  })

  test('plans are shown in the order admins give, new ones last', async () => {
    const first = await createPlan({})
    const second = await createPlan({})
    const paidIds = async () =>
      (await plansService.list())
        .filter((found) => !found.isDefault)
        .map(({ id }) => id)
    expect((await paidIds()).slice(-2)).toEqual([first.id, second.id])

    const ids = await paidIds()
    const reordered = [
      second.id,
      ...ids.filter((id) => id !== second.id && id !== first.id),
      first.id,
    ]
    expect(await plansService.reorder(reordered)).toBeUndefined()
    expect(await paidIds()).toEqual(reordered)
    const available = (await plansService.available()).map(({ id }) => id)
    expect(available.indexOf(second.id)).toBeLessThan(
      available.indexOf(first.id),
    )
    expect((await plansService.list())[0]?.isDefault).toBe(true)

    // All the paid plans, each once, or nothing changes.
    expect(await plansService.reorder(reordered.slice(1))).toBeInstanceOf(
      PlanOrderInvalidError,
    )
    expect(
      await plansService.reorder([
        ...reordered.slice(1),
        reordered[1] as string,
      ]),
    ).toBeInstanceOf(PlanOrderInvalidError)
    expect(await paidIds()).toEqual(reordered)
  })
})
