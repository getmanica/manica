import { defineRelations } from 'drizzle-orm'
import * as schema from './schema'

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    members: r.many.member(),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
    forgeApps: r.many.forgeApp(),
    agents: r.many.agent(),
    jobs: r.many.job(),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.member.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
      optional: false,
    }),
  },
  forgeApp: {
    organization: r.one.organization({
      from: r.forgeApp.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    createdBy: r.one.user({
      from: r.forgeApp.createdById,
      to: r.user.id,
    }),
  },
  agent: {
    organization: r.one.organization({
      from: r.agent.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    createdBy: r.one.user({
      from: r.agent.createdById,
      to: r.user.id,
    }),
  },
  runner: {
    agent: r.one.agent({
      from: r.runner.agentId,
      to: r.agent.id,
      optional: false,
    }),
    forgeApp: r.one.forgeApp({
      from: r.runner.forgeAppId,
      to: r.forgeApp.id,
      optional: false,
    }),
    reservedJob: r.one.job({
      from: r.runner.reservedJobId,
      to: r.job.id,
    }),
    job: r.one.job({
      from: r.runner.jobId,
      to: r.job.id,
    }),
  },
  job: {
    organization: r.one.organization({
      from: r.job.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    forgeApp: r.one.forgeApp({
      from: r.job.forgeAppId,
      to: r.forgeApp.id,
      optional: false,
    }),
  },
}))
