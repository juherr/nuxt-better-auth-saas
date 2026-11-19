// SPDX-License-Identifier: MIT
export interface OrganizationUpgradeInput {
  plan: string
  organizationId: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, unknown>
}

/**
 * Body of `client.subscription.upgrade` for an organization subscription.
 *
 * Since @better-auth/stripe 1.7, the organization is billed through its own
 * Stripe customer only with `customerType: 'organization'`; otherwise the
 * plugin bills the signed-in user's customer. The seat count is not sent:
 * the server sets it (see `checkoutSeatsOverride` in server/utils/stripe.ts).
 * https://better-auth.com/docs/plugins/stripe
 */
export function buildOrganizationUpgrade(input: OrganizationUpgradeInput) {
  return {
    plan: input.plan,
    customerType: 'organization' as const,
    referenceId: input.organizationId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl
  }
}
