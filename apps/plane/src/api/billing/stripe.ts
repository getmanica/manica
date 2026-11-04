import Stripe from 'stripe'
import { env } from '../platform/env'

// The Stripe API, while billing is on: shared by better-auth's Stripe plugin
// and plane's own calls (syncing and cancelling subscriptions). A holder,
// so tests can stand a fake in.
export const stripeApi: { client: Stripe | undefined } = {
  client: env.stripe ? new Stripe(env.stripe.apiKey) : undefined,
}
