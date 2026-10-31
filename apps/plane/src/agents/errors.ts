import { HTTPError } from 'elysia'

export class AgentNotFoundError extends HTTPError.id('AGENT_NOT_FOUND', 404) {}

export class AgentNameTakenError extends HTTPError.id('AGENT_NAME_TAKEN', 409) {
  override readonly detail = 'An agent with this name already exists'
}
