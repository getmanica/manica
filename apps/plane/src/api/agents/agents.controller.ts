import { Elysia, t } from 'elysia'
import { agentSorts } from '../../shared/pagination'
import { platformKeys } from '../../shared/platform'
import { authMacro } from '../auth/session'
import { listQuery } from '../platform/pagination'
import { agentsService } from './agents.service'
import { agentFields, manageAgents as manage } from './schema'

const { name, os, arch, slots, labels } = agentFields

export const agentsController = new Elysia({ prefix: '/agents' })
  .use(authMacro)
  .get(
    '/',
    {
      organization: true,
      query: t.Object({
        ...listQuery(agentSorts),
        // Platforms to keep; none keeps all.
        platform: t.Optional(t.Array(t.UnionEnum(platformKeys))),
      }),
    },
    ({ organizationId, query: { platform, ...options } }) =>
      agentsService.list(organizationId, { ...options, platforms: platform }),
  )
  .post(
    '/',
    {
      permission: manage,
      body: t.Object({
        name,
        os,
        arch,
        slots: t.Optional(slots),
        labels: t.Optional(labels),
      }),
    },
    ({ body, user, organizationId }) =>
      agentsService.create({
        ...body,
        name: body.name.trim(),
        organizationId,
        userId: user.id,
      }),
  )
  .patch(
    '/:id',
    {
      permission: manage,
      body: t.Object(
        {
          name: t.Optional(name),
          os: t.Optional(os),
          arch: t.Optional(arch),
          slots: t.Optional(slots),
          labels: t.Optional(labels),
        },
        { minProperties: 1 },
      ),
    },
    ({ body, params: { id }, organizationId }) =>
      agentsService.update(organizationId, id, {
        ...body,
        name: body.name?.trim(),
      }),
  )
  .delete(
    '/:id',
    { permission: manage },
    async ({ params: { id }, organizationId, status }) => {
      const error = await agentsService.delete(organizationId, id)
      return error ?? status(204)
    },
  )
  .post(
    '/:id/token',
    { permission: manage },
    ({ params: { id }, organizationId }) =>
      agentsService.regenerateToken(organizationId, id),
  )
