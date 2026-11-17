const ERROR_KEYS: Record<string, string> = {
  // @better-auth/stripe blocks the deletion while the organization's Stripe
  // customer has a subscription that is not canceled (trialing included).
  ORGANIZATION_HAS_ACTIVE_SUBSCRIPTION: 'dangerZone.errors.activeSubscription'
}

/**
 * Returns the i18n key of the message to show for an organization deletion
 * error, or undefined when the error's own message should be shown.
 */
export const organizationDeleteErrorKey = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : undefined
}
