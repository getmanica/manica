import { toOpenAPISchema } from '@elysia/openapi'
import { Elysia } from 'elysia'
import { expect, test } from 'vitest'
import { agentController } from './agent.controller'

// The agent API's OpenAPI spec, kept in openapi/agent.json: the agent
// generates its types from it, so a change to the API shows up there, in
// review, and fails the agent's build if it no longer fits. Update it with
// `bun run test -u`.

// What's of no use outside Elysia: its own annotations (`~` keys), the ids
// it gives models, OpenAPI 3.0's `nullable` (3.1 spells it `anyOf` with
// `null`, which it also emits), and the form encodings it accepts besides
// JSON, which agents don't send.
const DROPPED = new Set([
  '$id',
  'nullable',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
])

const clean = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(clean)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('~') && !DROPPED.has(key))
      .map(([key, entry]) => [key, clean(entry)]),
  )
}

test('the agent API matches openapi/agent.json', async () => {
  const api = new Elysia({ prefix: '/api' }).use(agentController)
  const { components, paths } = toOpenAPISchema(
    api,
    undefined,
    undefined,
    undefined,
    '3.1.0',
  )
  const spec = clean({
    openapi: '3.1.0',
    info: { title: 'Manica agent API', version: '1' },
    components,
    paths,
  })
  await expect(`${JSON.stringify(spec, null, 2)}\n`).toMatchFileSnapshot(
    '../../../openapi/agent.json',
  )
})
