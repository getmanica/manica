import { t } from 'elysia'
import { defaultPageSize } from '../../shared/pagination'
import { InvalidCursorError } from './errors'
import type { toolInput } from './tools/tool'

// MCP tools page like the console's tables (`listQuery`: page, size, sort,
// filters), and also hand back a cursor for the next page, so a client can
// keep going without restating the query.

export const cursorField = {
  cursor: t.Optional(
    t.String({
      maxLength: 2048,
      description:
        'The `nextCursor` of a previous call, to get the next page of the same query; other arguments are then ignored',
    }),
  ),
}

type Input = ReturnType<typeof toolInput>

const encode = (query: object) =>
  Buffer.from(JSON.stringify(query)).toString('base64url')

// The query a tool runs: its arguments, or the one a cursor carries, which is
// checked against the same schema as arguments are.
export const resolveQuery = async <Query extends { cursor?: string }>(
  input: Input,
  args: Query,
): Promise<Omit<Query, 'cursor'>> => {
  const { cursor, ...query } = args
  if (cursor === undefined) return query
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString())
  } catch {
    throw new InvalidCursorError()
  }
  if (typeof decoded !== 'object' || decoded === null || 'cursor' in decoded) {
    throw new InvalidCursorError()
  }
  const checked = await input['~standard'].validate(decoded)
  if (checked.issues) throw new InvalidCursorError()
  return checked.value as Omit<Query, 'cursor'>
}

// A page of results, with the cursor for the next one if there's more.
export const withCursor = <
  Query extends { page?: number; size?: number },
  Page extends { items: unknown[]; total: number },
>(
  query: Query,
  result: Page,
) => {
  const page = query.page ?? 1
  const size = query.size ?? defaultPageSize
  const more = page * size < result.total
  return {
    ...result,
    page,
    size,
    nextCursor: more ? encode({ ...query, page: page + 1 }) : undefined,
  }
}
