import { encrypt } from '../src/crypto'
import { db } from '../src/db'
import { agent, forgeApp, organization } from '../src/db/schema'

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
