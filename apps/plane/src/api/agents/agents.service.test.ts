import { beforeEach, describe, expect, test } from 'bun:test'
import { createAgent, createOrganization } from '../../../test/fixtures'
import { agentsService } from './agents.service'

let organizationId: string

beforeEach(async () => {
  ;({ organizationId } = await createOrganization())
  await createAgent(organizationId, {
    name: 'studio',
    labels: ['gpu'],
    createdAt: new Date('2026-10-01T00:00:00Z'),
  })
  await createAgent(organizationId, {
    name: 'builder',
    os: 'linux',
    arch: 'x86_64',
    version: '1.2.0',
    lastSeenAt: new Date('2026-10-31T00:00:00Z'),
    createdAt: new Date('2026-10-02T00:00:00Z'),
  })
  await createAgent(organizationId, {
    name: 'mini',
    lastSeenAt: new Date('2026-10-30T00:00:00Z'),
    createdAt: new Date('2026-10-03T00:00:00Z'),
  })
})

const listed = async (options?: Parameters<typeof agentsService.list>[1]) =>
  (await agentsService.list(organizationId, options)).items.map(
    ({ name }) => name,
  )

describe('list', () => {
  test('lists the newest agents first, and the platforms there are', async () => {
    const other = await createOrganization()
    expect(await agentsService.list(organizationId)).toMatchObject({
      total: 3,
      platforms: ['linux-x86_64', 'darwin-arm64'],
    })
    expect(await listed()).toEqual(['mini', 'builder', 'studio'])
    expect(await agentsService.list(other.organizationId)).toEqual({
      items: [],
      total: 0,
      platforms: [],
    })
  })

  test('pages through them', async () => {
    expect(await listed({ size: 10, page: 2 })).toEqual([])
  })

  test('sorts never-seen agents last either way', async () => {
    expect(await listed({ sort: 'lastSeenAt', dir: 'desc' })).toEqual([
      'builder',
      'mini',
      'studio',
    ])
    expect(await listed({ sort: 'lastSeenAt', dir: 'asc' })).toEqual([
      'mini',
      'builder',
      'studio',
    ])
  })

  test('filters by platform', async () => {
    expect(await listed({ platforms: ['linux-x86_64'] })).toEqual(['builder'])
    const { total } = await agentsService.list(organizationId, {
      platforms: ['windows-arm64', 'darwin-arm64'],
    })
    expect(total).toBe(2)
  })

  test('filters by text, as the console shows the agent', async () => {
    expect(await listed({ q: 'GPU' })).toEqual(['studio'])
    expect(await listed({ q: '1.2' })).toEqual(['builder'])
    expect(await listed({ q: 'macos arm' })).toEqual(['mini', 'studio'])
    expect(await listed({ q: '  ' })).toHaveLength(3)
  })
})
