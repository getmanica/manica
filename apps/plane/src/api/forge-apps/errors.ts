import { HTTPError } from 'elysia'

export class ForgeAppNotFoundError extends HTTPError.id(
  'FORGE_APP_NOT_FOUND',
  404,
) {}

export class ForgeAppSetupCallbackInvalidError extends HTTPError.id(
  'FORGE_APP_SETUP_CALLBACK_INVALID',
  400,
) {
  override readonly detail = 'The forge redirected back without a code or state'
}

export class ForgeAppSetupInvalidError extends HTTPError.id(
  'FORGE_APP_SETUP_INVALID',
  400,
) {
  override readonly detail = 'The app setup is unknown or has expired'
}
