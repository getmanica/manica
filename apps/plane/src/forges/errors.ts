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

export class ForgeAppSetupFailedError extends HTTPError.id(
  'FORGE_APP_SETUP_FAILED',
  502,
) {}

export class InvalidWebhookSignatureError extends HTTPError.id(
  'INVALID_WEBHOOK_SIGNATURE',
  401,
) {}

export class ForgeWebhookUrlNotPublicError extends HTTPError.id(
  'FORGE_WEBHOOK_URL_NOT_PUBLIC',
  400,
) {
  override readonly detail: string

  constructor(url: string) {
    super()
    this.detail = `The forge can't deliver webhooks to ${url}. Set PUBLIC_URL to a publicly reachable URL, e.g. a tunnel in development.`
  }
}
