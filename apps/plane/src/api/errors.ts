import { HTTPError } from 'elysia'

export class NoActiveOrganizationError extends HTTPError.id(
  'NO_ACTIVE_ORGANIZATION',
  400,
) {
  override readonly detail = 'Select an organization first'
}

export class ForbiddenError extends HTTPError.id('FORBIDDEN', 403) {}

export class UnauthorizedError extends HTTPError.id('UNAUTHORIZED', 401) {}

export class NotAMemberError extends HTTPError.id('NOT_A_MEMBER', 403) {
  override readonly detail =
    'You are no longer a member of this organization: select another one'
}
