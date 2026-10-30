import { Elysia, t } from 'elysia'
import { MAX_CUSTOM_LABELS, MAX_LABEL_LENGTH } from '../../shared/labels'
import { agentArches, agentOses } from '../../shared/platform'
import { authMacro, type Permissions } from '../auth/session'
import { agentsService } from './agents.service'

// Requires a non-blank character: the name is stored trimmed.
const name = t.String({ minLength: 1, maxLength: 64, pattern: '\\S' })
const os = t.UnionEnum(agentOses)
const arch = t.UnionEnum(agentArches)
const slots = t.Integer({ minimum: 1, maximum: 64 })
// See `isValidLabel`.
const labels = t.Array(
  t.String({
    minLength: 1,
    maxLength: MAX_LABEL_LENGTH,
    pattern: '^[^\\s,]+$',
  }),
  { maxItems: MAX_CUSTOM_LABELS },
)

// Managing agents takes the same permission as managing the organization.
const manage: Permissions = { organization: ['update'] }

export const agentsController = new Elysia({ prefix: '/agents' })
  .use(authMacro)
  .get('/', { organization: true }, ({ organizationId }) =>
    agentsService.list(organizationId),
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
