// SPDX-License-Identifier: MIT
/**
 * The item a single-price subscription bills through. The starter creates
 * every subscription with exactly one item, so a subscription without one
 * is a Stripe-side inconsistency, answered with a 500 rather than a crash.
 */
export function requireSubscriptionItem<T>(subscription: { items: { data: T[] } }): T {
  const [item] = subscription.items.data
  if (!item) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Subscription has no item'
    })
  }
  return item
}
