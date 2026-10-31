import {
  and,
  arrayContained,
  asc,
  count,
  eq,
  inArray,
  notExists,
} from 'drizzle-orm'
import { AgentNotFoundError } from '../agents/errors'
import { agentLabelSet } from '../agents/labels'
import type { AgentArch, AgentOs } from '../agents/platform'
import { db } from '../db'
import { isUniqueViolation } from '../db/errors'
import { agent, forgeApp, job, runner } from '../db/schema'
import { appContext } from '../forges/context'
import type { Forge, ForgeKind } from '../forges/forge'
import type { RunnerDistribution } from './distribution'
import { RunnerNotFoundError } from './errors'
import { liveStates, runnerName } from './states'

// How long a runner is kept for its agent without hearing from it. Agents
// poll well within it; a slow forge registration also has to fit.
export const LEASE_MS = 60 * 1000

const RESERVATION_CONSTRAINT = 'runner_reservedJobId_live_unique'

const leaseFrom = (now: Date) => new Date(now.getTime() + LEASE_MS)

export type PollInput = {
  // Whether the agent takes new jobs: false while it shuts down.
  accepting: boolean
  // The runners the agent holds: starting, running, or exited but not yet
  // reported.
  runners: string[]
}

export type PollResult = {
  start: { id: string; name: string; config: string }[]
  // Runners the agent should stop: the plane has given up on them.
  cancel: string[]
  leaseSeconds: number
  // The runner build to start runners with.
  runner: RunnerDistribution | null
}

type Distribution = {
  for(platform: {
    os: AgentOs
    arch: AgentArch
  }): Promise<RunnerDistribution | undefined>
}

export const createRunnersService = (
  forges: Record<ForgeKind, Forge>,
  distribution: Distribution,
) => {
  // Reconciles what the agent holds with what the plane thinks it does, then
  // claims queued jobs for its free slots. Returns the claimed runners, to
  // register outside the transaction.
  const reconcileAndClaim = (agentId: string, input: PollInput, now: Date) =>
    db.transaction(async (tx) => {
      // Serializes the agent's polls, so two can't fill the same slot.
      const [locked] = await tx
        .select()
        .from(agent)
        .where(eq(agent.id, agentId))
        .for('update')
      if (!locked) throw new AgentNotFoundError()
      await tx
        .update(agent)
        .set({ lastSeenAt: now })
        .where(eq(agent.id, agentId))

      const held = new Set(input.runners)
      const known = await tx
        .select({ id: runner.id, state: runner.state, jobId: runner.jobId })
        .from(runner)
        .where(
          and(
            eq(runner.agentId, agentId),
            inArray(runner.state, [...liveStates, 'lost']),
          ),
        )

      const cancel = input.runners.filter(
        (id) => !known.some((known) => known.id === id),
      )
      for (const { id, state, jobId } of known) {
        if (held.has(id)) {
          // The agent has it: renew it. A runner given up on as lost was only
          // out of touch: it's back, and no longer to unregister.
          await tx
            .update(runner)
            .set(
              state === 'lost'
                ? {
                    leaseExpiresAt: leaseFrom(now),
                    state: jobId ? 'running' : 'acked',
                    finishedAt: null,
                    cleanupAt: null,
                  }
                : {
                    leaseExpiresAt: leaseFrom(now),
                    state: state === 'issued' ? 'acked' : state,
                  },
            )
            .where(eq(runner.id, id))
        } else if (state === 'acked' || state === 'running') {
          // The agent had it and no longer does: its process is gone without
          // being reported (e.g. the agent restarted). Runners still being
          // registered or issued (or lost) may just not have reached it yet:
          // they're left to their lease.
          await tx
            .update(runner)
            .set({
              state: state === 'running' ? 'lost' : 'released',
              finishedAt: now,
              cleanupAt: now,
            })
            .where(eq(runner.id, id))
        }
      }

      if (!input.accepting) return { agent: locked, claimed: [], cancel }

      const [occupied] = await tx
        .select({ count: count() })
        .from(runner)
        .where(
          and(eq(runner.agentId, agentId), inArray(runner.state, liveStates)),
        )
      const free = locked.slots - (occupied?.count ?? 0)
      if (free <= 0) return { agent: locked, claimed: [], cancel }

      const queued = await tx
        .select({
          id: job.id,
          forgeAppId: job.forgeAppId,
          installationId: job.installationId,
          repository: job.repository,
          labels: job.labels,
        })
        .from(job)
        .where(
          and(
            eq(job.organizationId, locked.organizationId),
            eq(job.status, 'queued'),
            arrayContained(job.labels, agentLabelSet(locked)),
            notExists(
              tx
                .select({ id: runner.id })
                .from(runner)
                .where(
                  and(
                    eq(runner.reservedJobId, job.id),
                    inArray(runner.state, liveStates),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(job.queuedAt))
        .limit(free)
        .for('update', { skipLocked: true, of: job })
      if (queued.length === 0) return { agent: locked, claimed: [], cancel }

      const claimed = await tx
        .insert(runner)
        .values(
          queued.map((queued) => ({
            id: crypto.randomUUID(),
            agentId,
            forgeAppId: queued.forgeAppId,
            installationId: queued.installationId,
            repository: queued.repository,
            labels: queued.labels,
            state: 'registering' as const,
            reservedJobId: queued.id,
            leaseExpiresAt: leaseFrom(now),
          })),
        )
        .returning()
      return { agent: locked, claimed, cancel }
    })

  // Registers a claimed runner with its forge, handing out its config only
  // if the claim still holds by then. Anything else leaves the registration
  // to clean up.
  const register = async (claimed: typeof runner.$inferSelect) => {
    const name = runnerName(claimed.id)
    try {
      const [app] = await db
        .select()
        .from(forgeApp)
        .where(eq(forgeApp.id, claimed.forgeAppId))
      if (!app) throw new Error(`Forge app ${claimed.forgeAppId} is gone`)
      const created = await forges[app.forge].createRunner({
        app: await appContext(app),
        installationId: claimed.installationId,
        repository: claimed.repository,
        name,
        labels: claimed.labels,
      })
      const now = new Date()
      const [issued] = await db
        .update(runner)
        .set({
          state: 'issued',
          externalRunnerId: created.externalRunnerId,
          leaseExpiresAt: leaseFrom(now),
        })
        .where(and(eq(runner.id, claimed.id), eq(runner.state, 'registering')))
        .returning({ id: runner.id })
      if (issued) return { id: claimed.id, name, config: created.config }
      // Given up on while registering (its lease expired): unregister it.
      await db
        .update(runner)
        .set({ externalRunnerId: created.externalRunnerId, cleanupAt: now })
        .where(eq(runner.id, claimed.id))
    } catch (error) {
      console.error(`registering runner ${claimed.id} failed:`, error)
      // The forge may have registered it anyway (e.g. the response was
      // lost): cleanup looks it up by name.
      const now = new Date()
      await db
        .update(runner)
        .set({ state: 'released', finishedAt: now, cleanupAt: now })
        .where(and(eq(runner.id, claimed.id), eq(runner.state, 'registering')))
    }
    return undefined
  }

  return {
    // An agent checking in: reports the runners it holds, renews their
    // leases, and gets new runners for its free slots.
    async poll(agentId: string, polled: PollInput): Promise<PollResult> {
      const now = new Date()
      const [platform] = await db
        .select({ os: agent.os, arch: agent.arch })
        .from(agent)
        .where(eq(agent.id, agentId))
      if (!platform) throw new AgentNotFoundError()
      // Without a runner build to run them with, runners would only fail.
      const runnerBuild = await distribution.for(platform)
      const input = { ...polled, accepting: polled.accepting && !!runnerBuild }

      let result: Awaited<ReturnType<typeof reconcileAndClaim>>
      try {
        result = await reconcileAndClaim(agentId, input, now)
      } catch (error) {
        // Another agent's runner reserved one of the jobs first: the agent
        // gets it next poll.
        if (!isUniqueViolation(error, RESERVATION_CONSTRAINT)) throw error
        result = await reconcileAndClaim(
          agentId,
          { ...input, accepting: false },
          now,
        )
      }
      const registered = await Promise.all(result.claimed.map(register))
      return {
        start: registered.filter((started) => started !== undefined),
        cancel: result.cancel,
        leaseSeconds: LEASE_MS / 1000,
        runner: runnerBuild ?? null,
      }
    },

    // The agent's runner process exited. Repeats are harmless.
    async exited(agentId: string, id: string, exitCode: number | null) {
      const now = new Date()
      const [found] = await db
        .select({ state: runner.state })
        .from(runner)
        .where(and(eq(runner.id, id), eq(runner.agentId, agentId)))
      if (!found) throw new RunnerNotFoundError()
      await db
        .update(runner)
        .set({
          state: 'exited',
          exitCode,
          finishedAt: now,
          // An ephemeral runner unregisters itself after its job; one that
          // exited before may not have.
          cleanupAt: now,
        })
        .where(
          and(
            eq(runner.id, id),
            inArray(runner.state, ['issued', 'acked', 'running', 'lost']),
          ),
        )
    },
  }
}
