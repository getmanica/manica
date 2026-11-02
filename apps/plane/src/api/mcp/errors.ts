import type { CallToolResult } from '@modelcontextprotocol/server'
import { HTTPError } from 'elysia'

export class InvalidCursorError extends HTTPError.id('INVALID_CURSOR', 400) {
  override readonly detail =
    'The cursor is invalid or expired: list again without one'
}

export class NoChangesError extends HTTPError.id('NO_CHANGES', 400) {
  override readonly detail = 'Pass at least one field to change'
}

export class ToolFailedError extends HTTPError.id('INTERNAL', 500) {
  override readonly detail = 'Something went wrong'
}

// The one place typed errors become tool errors: a result the model reads,
// with the error's code and its human-readable detail, rather than a
// protocol error.
export const toolError = (error: HTTPError): CallToolResult => {
  const code = error.code ?? 'ERROR'
  const message = error.detail || error.message || code
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { code, message },
  }
}

// A service's answer as a tool result: services return their expected
// failures, and these become tool errors like thrown ones.
const toolResult = (value: unknown): CallToolResult => {
  if (value instanceof HTTPError) return toolError(value)
  // As the client will see it: dates become ISO strings.
  const structured = JSON.parse(JSON.stringify(value ?? {}))
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  }
}

// Runs a tool's work, turning its result, or the typed error it throws,
// into the tool's answer. Anything else is logged and reported as internal.
export const runTool = async (work: () => Promise<unknown>) => {
  try {
    return toolResult(await work())
  } catch (error) {
    if (error instanceof HTTPError) return toolError(error)
    console.error('MCP tool failed', error)
    return toolError(new ToolFailedError())
  }
}

export class McpClientNotFoundError extends HTTPError.id(
  'MCP_CLIENT_NOT_FOUND',
  404,
) {
  override readonly detail = 'This app is not registered, or not connected'
}

export class McpConsentInvalidError extends HTTPError.id(
  'MCP_CONSENT_INVALID',
  400,
) {
  override readonly detail =
    'This request to connect an app is invalid or expired: start again from the app'
}

export class McpOrganizationRequiredError extends HTTPError.id(
  'MCP_ORGANIZATION_REQUIRED',
  400,
) {
  override readonly detail = 'Pick the organization the app acts in'
}

export class CrossOriginRequestError extends HTTPError.id(
  'CROSS_ORIGIN_REQUEST',
  403,
) {
  override readonly detail = 'Requests must come from the console'
}
