import { encrypt } from '../src/api/platform/crypto'
import { db } from '../src/api/platform/db'
import {
  agent,
  forgeApp,
  job,
  member,
  organization,
  user,
} from '../src/api/platform/db/schema'

// An organization with a forge app, to hang test data off.
export const createOrganization = async () => {
  const id = crypto.randomUUID()
  await db
    .insert(organization)
    .values({ id, name: id, slug: id, createdAt: new Date() })
  const [app] = await db
    .insert(forgeApp)
    .values({
      id: crypto.randomUUID(),
      forge: 'github',
      externalId: id,
      slug: 'manica',
      name: 'Manica',
      url: 'https://github.com/apps/manica',
      owner: 'acme',
      secrets: await encrypt(JSON.stringify({ privateKey: 'test' })),
      organizationId: id,
    })
    .returning()
  if (!app) throw new Error('No forge app created')
  return { organizationId: id, app }
}

export const createAgent = async (
  organizationId: string,
  values: Partial<typeof agent.$inferInsert> = {},
) => {
  const [created] = await db
    .insert(agent)
    .values({
      id: crypto.randomUUID(),
      name: `agent-${crypto.randomUUID()}`,
      os: 'darwin',
      arch: 'arm64',
      tokenHash: crypto.randomUUID(),
      organizationId,
      ...values,
    })
    .returning()
  if (!created) throw new Error('No agent created')
  return created
}

export const createUser = async () => {
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

export const createMember = async (
  organizationId: string,
  userId: string,
  role = 'member',
) => {
  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

export const createJob = async (
  organizationId: string,
  forgeAppId: string,
  values: Partial<typeof job.$inferInsert> = {},
) => {
  const id = crypto.randomUUID()
  const [created] = await db
    .insert(job)
    .values({
      id,
      organizationId,
      forgeAppId,
      externalId: id,
      runId: '1',
      installationId: '7',
      repository: 'acme/widgets',
      name: `job-${id}`,
      url: 'https://github.com/acme/widgets/actions/runs/1',
      labels: ['self-hosted'],
      status: 'queued',
      queuedAt: new Date(),
      ...values,
    })
    .returning()
  if (!created) throw new Error('No job created')
  return created
}
