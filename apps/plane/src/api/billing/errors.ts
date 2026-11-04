import { HTTPError } from 'elysia'
import type { PlanLimit } from '../platform/db/schema'

export class BillingDisabledError extends HTTPError.id(
  'BILLING_DISABLED',
  404,
) {
  override readonly detail = 'Billing is not set up on this plane'
}

export class PlanNotFoundError extends HTTPError.id('PLAN_NOT_FOUND', 404) {}

export class PlanNameTakenError extends HTTPError.id('PLAN_NAME_TAKEN', 409) {
  override readonly detail = 'A plan with this name already exists'
}

export class PlanPriceTakenError extends HTTPError.id('PLAN_PRICE_TAKEN', 409) {
  override readonly detail =
    'Another plan uses, or used, this price: create a new price in Stripe'
}

export class PlanPricesInvalidError extends HTTPError.id(
  'PLAN_PRICES_INVALID',
  400,
) {
  override readonly detail =
    'The default plan has no prices; every other plan needs a monthly price'
}

export class DefaultPlanRequiredError extends HTTPError.id(
  'DEFAULT_PLAN_REQUIRED',
  409,
) {
  override readonly detail =
    "Users without a subscription are on the default plan: it can't be deleted, only edited"
}

export class PlanInUseError extends HTTPError.id('PLAN_IN_USE', 409) {
  override readonly detail =
    'Users are subscribed to this plan, or checking out: disable it instead, so nobody new subscribes'
}

export class PlanOrderInvalidError extends HTTPError.id(
  'PLAN_ORDER_INVALID',
  409,
) {
  override readonly detail =
    'The plans changed since you loaded them: reload, and order them again'
}

const limitNouns: Record<PlanLimit, [one: string, many: string]> = {
  organizations: ['organization', 'organizations'],
  agents: ['agent', 'agents'],
  forgeApps: ['forge app', 'forge apps'],
}

export class PlanLimitReachedError extends HTTPError.id(
  'PLAN_LIMIT_REACHED',
  403,
) {
  override readonly detail: string
  constructor(
    readonly limit: PlanLimit,
    max: number,
  ) {
    super()
    this.detail = `Your plan allows ${max} ${limitNouns[limit][max === 1 ? 0 : 1]}: upgrade it, or delete some first`
  }
}

export class OrganizationDisabledError extends HTTPError.id(
  'ORGANIZATION_DISABLED',
  403,
) {
  override readonly detail =
    "This organization is past its billing owner's plan: it's read-only until they upgrade or make room"
}

export class SwapInvalidError extends HTTPError.id('SWAP_INVALID', 400) {
  override readonly detail =
    'Pick one of your disabled resources to enable and one of your enabled ones to disable, of the same kind'
}

export class PlanUnavailableError extends HTTPError.id(
  'PLAN_UNAVAILABLE',
  400,
) {
  override readonly detail = 'This plan is not available'
}

export class BillingCancelFailedError extends HTTPError.id(
  'BILLING_CANCEL_FAILED',
  502,
) {
  override readonly detail: string

  constructor(
    detail = "The subscription couldn't be cancelled with Stripe, so nothing was deleted: try again",
  ) {
    super()
    this.detail = detail
  }
}

export class PaymentOverdueError extends HTTPError.id('PAYMENT_OVERDUE', 402) {
  override readonly detail =
    'Your last payment failed: settle it from Manage subscription before changing plans'
}

export class NotACustomerError extends HTTPError.id('NOT_A_CUSTOMER', 404) {
  override readonly detail = 'You have no billing details to manage yet'
}

export class ScheduledChangeError extends HTTPError.id(
  'SCHEDULED_CHANGE',
  400,
) {
  override readonly detail =
    'Plans change at once, not at the end of the period'
}

export class CheckoutsNotExpiredError extends HTTPError.id(
  'CHECKOUTS_NOT_EXPIRED',
  502,
) {
  override readonly detail =
    "The plan was saved, but checkouts still open for it couldn't be expired with Stripe: save it again"
}

export class NotSubscribedError extends HTTPError.id('NOT_SUBSCRIBED', 409) {
  override readonly detail = 'Subscribe to a plan first'
}

export class AlreadySubscribedError extends HTTPError.id(
  'ALREADY_SUBSCRIBED',
  409,
) {
  override readonly detail =
    'You already have a subscription: change its plan instead of subscribing again'
}
