import { HTTPError } from 'elysia'

export class UserNotFoundError extends HTTPError.id('USER_NOT_FOUND', 404) {}

export class CannotRemoveSelfError extends HTTPError.id(
  'CANNOT_REMOVE_SELF',
  400,
) {
  override readonly detail =
    "You can't remove yourself: delete your account from your profile"
}

export class CannotBanSelfError extends HTTPError.id('CANNOT_BAN_SELF', 400) {
  override readonly detail = "You can't ban yourself"
}
