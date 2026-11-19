// SPDX-License-Identifier: MIT
const ERROR_KEYS: Record<string, string> = {
  // better-auth 1.7 refuses to link an OAuth identity to an existing account
  // whose email is not verified (account.accountLinking.requireLocalEmailVerified).
  account_not_linked: 'signIn.errors.accountNotLinked'
}

/**
 * Returns the i18n key of the message for the `error` query parameter that
 * the OAuth callback appends to the sign-in page, or undefined without one.
 */
export const socialSignInErrorKey = (error: string | null | undefined | (string | null)[]): string | undefined => {
  const code = Array.isArray(error) ? error[0] : error
  if (!code)
    return undefined
  return Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : 'signIn.errors.socialSignInFailed'
}
