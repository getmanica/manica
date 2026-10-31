import { Elysia, t } from 'elysia'
import { assertPermission, authMacro } from '../auth'
import { agentsService } from './agents.service'
import { agentArches, agentOses } from './platform'

// Requires a non-blank character: the name is stored trimmed.
const name = t.String({ minLength: 1, maxLength: 64, pattern: '\\S' })
const os = t.UnionEnum(agentOses)
const arch = t.UnionEnum(agentArches)

// Managing agents takes the same permission as managing the organization.
const assertCanManage = (headers: Headers) =>
  assertPermission(headers, { permissions: { organization: ['update'] } })

export const agentsController = new Elysia({ prefix: '/agents' })
  .use(authMacro)
  .get('/', { organization: true }, ({ organizationId }) =>
    agentsService.list(organizationId),
  )
  .post(
    '/',
    { organization: true, body: t.Object({ name, os, arch }) },
    async ({ body, user, organizationId, request: { headers } }) => {
      await assertCanManage(headers)
      return agentsService.create({
        ...body,
        name: body.name.trim(),
        organizationId,
        userId: user.id,
      })
    },
  )
  .patch(
    '/:id',
    {
      organization: true,
      body: t.Object(
        { name: t.Optional(name), os: t.Optional(os), arch: t.Optional(arch) },
        { minProperties: 1 },
      ),
    },
    async ({ body, params: { id }, organizationId, request: { headers } }) => {
      await assertCanManage(headers)
      return agentsService.update(organizationId, id, {
        ...body,
        name: body.name?.trim(),
      })
    },
  )
  .delete(
    '/:id',
    { organization: true },
    async ({
      params: { id },
      organizationId,
      request: { headers },
      status,
    }) => {
      await assertCanManage(headers)
      await agentsService.delete(organizationId, id)
      return status(204)
    },
  )
  .post(
    '/:id/token',
    { organization: true },
    async ({ params: { id }, organizationId, request: { headers } }) => {
      await assertCanManage(headers)
      return agentsService.regenerateToken(organizationId, id)
    },
  )
