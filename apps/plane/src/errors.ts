import { HTTPError } from 'elysia'

export class NoActiveOrganizationError extends HTTPError.id(
  'NO_ACTIVE_ORGANIZATION',
  400,
) {
  override readonly detail = 'Select an organization first'
}

export class ForbiddenError extends HTTPError.id('FORBIDDEN', 403) {}

export class UnauthorizedError extends HTTPError.id('UNAUTHORIZED', 401) {}
