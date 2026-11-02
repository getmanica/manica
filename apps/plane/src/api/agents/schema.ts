import { t } from 'elysia'
import { MAX_CUSTOM_LABELS, MAX_LABEL_LENGTH } from '../../shared/labels'
import { agentArches, agentOses } from '../../shared/platform'
import type { Permissions } from '../auth/principal'

// An agent's editable fields, as the console API and the MCP tools take them.
export const agentFields = {
  // Requires a non-blank character: the name is stored trimmed.
  name: t.String({ minLength: 1, maxLength: 64, pattern: '\\S' }),
  os: t.UnionEnum(agentOses),
  arch: t.UnionEnum(agentArches),
  slots: t.Integer({ minimum: 1, maximum: 64 }),
  // See `isValidLabel`.
  labels: t.Array(
    t.String({
      minLength: 1,
      maxLength: MAX_LABEL_LENGTH,
      pattern: '^[^\\s,]+$',
    }),
    { maxItems: MAX_CUSTOM_LABELS },
  ),
}

// Managing agents takes the same permission as managing the organization.
export const manageAgents: Permissions = { organization: ['update'] }
