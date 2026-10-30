import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { normalizeLabels } from '../../shared/labels'
import type { AgentArch, AgentOs } from '../../shared/platform'
import { db } from '../platform/db'
import { isUniqueViolation } from '../platform/db/errors'
import { agent, liveStates, runner } from '../platform/db/schema'
import {
  AgentBusyError,
  AgentNameTakenError,
  AgentNotFoundError,
} from './errors'

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
  slots: agent.slots,
  labels: agent.labels,
  lastSeenAt: agent.lastSeenAt,
  version: agent.version,
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

// How many of its slots the agent is using.
const running = sql<number>`(
  select count(*)::int from ${runner}
  where ${runner.agentId} = ${agent.id}
  and ${inArray(runner.state, liveStates)}
)`

// Expected failures are returned rather than thrown, so the controllers
// return them as is and they're part of the routes' types.
export const agentsService = {
  list: (organizationId: string) =>
    db
      .select({ ...publicColumns, running })
      .from(agent)
      .where(eq(agent.organizationId, organizationId))
      .orderBy(desc(agent.createdAt)),

  // Returns the plaintext token: this is the only time it's available.
  async create(input: {
    name: string
    os: AgentOs
    arch: AgentArch
    slots?: number
    labels?: string[]
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
        slots: input.slots,
        labels: input.labels && normalizeLabels(input.labels),
        tokenHash: hashToken(token),
        organizationId: input.organizationId,
        createdById: input.userId,
      })
      .onConflictDoNothing({ target: [agent.organizationId, agent.name] })
      .returning()
    if (!created) return new AgentNameTakenError()
    return { agent: toPublic(created), token }
  },

  async update(
    organizationId: string,
    id: string,
    changes: {
      name?: string
      os?: AgentOs
      arch?: AgentArch
      slots?: number
      labels?: string[]
    },
  ) {
    try {
      const [updated] = await db
        .update(agent)
        .set({
          ...changes,
          labels: changes.labels && normalizeLabels(changes.labels),
        })
        .where(owned(organizationId, id))
        .returning()
      if (!updated) return new AgentNotFoundError()
      return toPublic(updated)
    } catch (error) {
      if (isUniqueViolation(error, NAME_CONSTRAINT)) {
        return new AgentNameTakenError()
      }
      throw error
    }
  },

  // Resolves to nothing once deleted. Refused while the agent has runners: deleting it would drop their
  // leases and the jobs they hold. The agent row is locked as its polls lock
  // it, so it can't claim one meanwhile.
  delete: (organizationId: string, id: string) =>
    db.transaction(async (tx) => {
      const [found] = await tx
        .select({ id: agent.id })
        .from(agent)
        .where(owned(organizationId, id))
        .for('update')
      if (!found) return new AgentNotFoundError()
      const [live] = await tx
        .select({ id: runner.id })
        .from(runner)
        .where(and(eq(runner.agentId, id), inArray(runner.state, liveStates)))
        .limit(1)
      if (live) return new AgentBusyError()
      await tx.delete(agent).where(eq(agent.id, id))
    }),

  // Resolves an agent from its plaintext token, or undefined if no agent has
  // it (e.g. it was regenerated or the agent deleted).
  async authenticate(token: string) {
    if (!token.startsWith(TOKEN_PREFIX)) return undefined
    const [found] = await db
      .select()
      .from(agent)
      .where(eq(agent.tokenHash, hashToken(token)))
    return found
  },

  // Records that the agent just checked in.
  async heartbeat(id: string) {
    const [updated] = await db
      .update(agent)
      .set({ lastSeenAt: new Date() })
      .where(eq(agent.id, id))
      .returning()
    if (!updated) return new AgentNotFoundError()
    return toPublic(updated)
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
    if (!updated) return new AgentNotFoundError()
    return { agent: toPublic(updated), token }
  },
}
