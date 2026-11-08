import { describe, expect, test, vi } from 'vitest'
import { AgentNameTakenError, AgentNotFoundError } from '../agents/errors'
import { ForbiddenError } from '../errors'
import { runTool } from './errors'

describe('runTool', () => {
  test('a result becomes structured content, dates as strings', async () => {
    const at = new Date('2026-11-02T10:00:00Z')
    expect(await runTool(async () => ({ id: 'a', at }))).toEqual({
      content: [
        { type: 'text', text: '{"id":"a","at":"2026-11-02T10:00:00.000Z"}' },
      ],
      structuredContent: { id: 'a', at: '2026-11-02T10:00:00.000Z' },
    })
  })

  test('a returned typed error is a tool error with its code and detail', async () => {
    expect(await runTool(async () => new AgentNameTakenError())).toEqual({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'AGENT_NAME_TAKEN: An agent with this name already exists',
        },
      ],
      structuredContent: {
        code: 'AGENT_NAME_TAKEN',
        message: 'An agent with this name already exists',
      },
    })
  })

  test('a thrown typed error is too, falling back to its code', async () => {
    const result = await runTool(async () => {
      throw new ForbiddenError()
    })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toMatchObject({ code: 'FORBIDDEN' })
    const notFound = await runTool(async () => new AgentNotFoundError())
    expect(notFound.structuredContent).toMatchObject({
      code: 'AGENT_NOT_FOUND',
    })
  })

  test('anything else is logged, and reported without its details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runTool(async () => {
      throw new Error('connection string postgres://secret')
    })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'INTERNAL: Something went wrong' }],
      structuredContent: { code: 'INTERNAL', message: 'Something went wrong' },
    })
  })
})
