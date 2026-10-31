import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db'
import { isUniqueViolation } from '../db/errors'
import { agent } from '../db/schema'
import { AgentNameTakenError, AgentNotFoundError } from './errors'
import type { AgentArch, AgentOs } from './platform'

// Tokens are prefixed so they're recognizable (e.g. by secret scanners).
const TOKEN_PREFIX = 'mna_'

const generateToken = () =>
  `${TOKEN_PREFIX}${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`

// Tokens carry 256 bits of entropy, so a plain hash is enough: no salt or
// slow KDF needed, and it keeps lookups by token a single indexed query.
export const hashToken = (token: string) =>
  new Bun.CryptoHasher('sha256').update(token).digest('hex')

const NAME_CONSTRAINT = 'agent_organizationId_name_unique'

const publicColumns = {
  id: agent.id,
  name: agent.name,
  os: agent.os,
  arch: agent.arch,
  lastSeenAt: agent.lastSeenAt,
  createdAt: agent.createdAt,
  updatedAt: agent.updatedAt,
}

const toPublic = ({
  tokenHash: _,
  organizationId: __,
  createdById: ___,
  ...rest
}: typeof agent.$inferSelect) => rest

// Scopes a query to one of the organization's agents, so an agent id from
// another organization reads as not found.
const owned = (organizationId: string, id: string) =>
  and(eq(agent.id, id), eq(agent.organizationId, organizationId))

export const agentsService = {
  list: (organizationId: string) =>
    db
      .select(publicColumns)
      .from(agent)
      .where(eq(agent.organizationId, organizationId))
      .orderBy(desc(agent.createdAt)),

  // Returns the plaintext token: this is the only time it's available.
  async create(input: {
    name: string
    os: AgentOs
    arch: AgentArch
    organizationId: string
    userId: string
  }) {
    const token = generateToken()
    const [created] = await db
      .insert(agent)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        os: input.os,
        arch: input.arch,
        tokenHash: hashToken(token),
        organizationId: input.organizationId,
        createdById: input.userId,
      })
      .onConflictDoNothing({ target: [agent.organizationId, agent.name] })
      .returning()
    if (!created) throw new AgentNameTakenError()
    return { agent: toPublic(created), token }
  },

  async update(
    organizationId: string,
    id: string,
    changes: { name?: string; os?: AgentOs; arch?: AgentArch },
  ) {
    try {
      const [updated] = await db
        .update(agent)
        .set(changes)
        .where(owned(organizationId, id))
        .returning()
      if (!updated) throw new AgentNotFoundError()
      return toPublic(updated)
    } catch (error) {
      if (isUniqueViolation(error, NAME_CONSTRAINT)) {
        throw new AgentNameTakenError()
      }
      throw error
    }
  },

  async delete(organizationId: string, id: string) {
    const [deleted] = await db
      .delete(agent)
      .where(owned(organizationId, id))
      .returning()
    if (!deleted) throw new AgentNotFoundError()
  },

  // Replaces the agent's token, so the previous one stops working. Returns the
  // new plaintext token: this is the only time it's available.
  async regenerateToken(organizationId: string, id: string) {
    const token = generateToken()
    const [updated] = await db
      .update(agent)
      .set({ tokenHash: hashToken(token) })
      .where(owned(organizationId, id))
      .returning()
    if (!updated) throw new AgentNotFoundError()
    return { agent: toPublic(updated), token }
  },
}
