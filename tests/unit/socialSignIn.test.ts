import { describe, expect, it } from 'vitest'
import messages from '~~/app/pages/signin/i18n.json'
import { socialSignInErrorKey } from '~~/app/utils/socialSignIn'

// The social sign-in sends OAuth callback failures back to the sign-in
// page as ?error=<code>. better-auth 1.7 refuses to link a Google or
// GitHub identity to an existing account whose email is not verified,
// with the code account_not_linked.

describe('socialSignInErrorKey', () => {
  it('maps an account that could not be linked to its message', () => {
    expect(socialSignInErrorKey('account_not_linked')).toBe('signIn.errors.accountNotLinked')
  })

  it('maps any other OAuth failure to a generic message', () => {
    expect(socialSignInErrorKey('email_not_found')).toBe('signIn.errors.socialSignInFailed')
    expect(socialSignInErrorKey(['no_code'])).toBe('signIn.errors.socialSignInFailed')
    // The query string is user input.
    expect(socialSignInErrorKey('constructor')).toBe('signIn.errors.socialSignInFailed')
  })

  it('shows nothing without an error', () => {
    expect(socialSignInErrorKey(undefined)).toBeUndefined()
    expect(socialSignInErrorKey(null)).toBeUndefined()
    expect(socialSignInErrorKey('')).toBeUndefined()
    expect(socialSignInErrorKey([])).toBeUndefined()
  })

  it('has the messages in every locale', () => {
    for (const locale of ['en', 'zh-CN', 'ja', 'fr'] as const) {
      expect(messages[locale].signIn.errors.accountNotLinked, locale).toBeTruthy()
      expect(messages[locale].signIn.errors.socialSignInFailed, locale).toBeTruthy()
    }
  })
})
