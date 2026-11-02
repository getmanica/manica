import { fromJsonSchema } from '@modelcontextprotocol/server'
import type { AnySchema, UnwrapSchema } from 'elysia'
import { mcpScopes } from '../../auth/better-auth'
import { can, type Permissions, type Principal } from '../../auth/principal'
import { ForbiddenError } from '../../errors'

// What a tool call acts as: the user, in the organization they connected the
// client to, with the scopes they granted it.
export type ToolContext = {
  principal: Principal
  scopes: readonly string[]
}

// A tool's input schema, from a TypeBox schema like the console API's: it's
// JSON Schema, which the MCP SDK validates against.
export const toolInput = <Schema extends AnySchema>(schema: Schema) =>
  fromJsonSchema<UnwrapSchema<Schema>>(
    JSON.parse(JSON.stringify(schema)) as Parameters<typeof fromJsonSchema>[0],
  )

// Writing takes the `plane:write` scope AND a role granting `permissions`.
// The scope is checked before the call reaches a tool (see the controller),
// so a client can step up; this keeps tools safe on their own.
export const authorizeWrite = async (
  { principal, scopes }: ToolContext,
  permissions: Permissions,
) => {
  if (!scopes.includes(mcpScopes.write)) throw new ForbiddenError()
  if (!(await can(principal, permissions))) throw new ForbiddenError()
}
