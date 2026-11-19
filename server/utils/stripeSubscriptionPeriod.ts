// SPDX-License-Identifier: MIT
/**
 * Minimal shape shared by the Stripe API subscription (current and legacy
 * payloads) and the loosely typed objects our callers hold.
 */
interface SubscriptionWithPeriod {
  current_period_end?: number | null
  items?: { data?: Array<{ current_period_end?: number | null }> }
}

/**
 * End of the current period of a Stripe subscription, in Unix seconds.
 *
 * API 2025-03-31.basil moved `current_period_end` from the subscription to
 * its items (https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end.md).
 * Webhook payloads follow the endpoint's API version, not the client's
 * (https://docs.stripe.com/webhooks/versioning), so an endpoint pinned
 * before basil still sends the top-level field: keep it as a fallback.
 */
export function getStripeSubscriptionPeriodEndSeconds(subscription: SubscriptionWithPeriod): number | null {
  return subscription.items?.data?.[0]?.current_period_end
    || subscription.current_period_end
    || null
}

export function getStripeSubscriptionPeriodEnd(subscription: SubscriptionWithPeriod): Date | null {
  const seconds = getStripeSubscriptionPeriodEndSeconds(subscription)
  return seconds ? new Date(seconds * 1000) : null
}
