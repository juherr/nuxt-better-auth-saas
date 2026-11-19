// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import messages from '~~/app/components/settings/DangerZone.i18n.json'
import { organizationDeleteErrorKey } from '~~/app/utils/organizationDeletion'

// @better-auth/stripe 1.7 refuses to delete an organization whose Stripe
// customer still has a subscription that is not canceled, with the code
// ORGANIZATION_HAS_ACTIVE_SUBSCRIPTION.

describe('organizationDeleteErrorKey', () => {
  it('maps an active subscription refusal to its message', () => {
    expect(organizationDeleteErrorKey({ code: 'ORGANIZATION_HAS_ACTIVE_SUBSCRIPTION' }))
      .toBe('dangerZone.errors.activeSubscription')
  })

  it('leaves other errors to their own message', () => {
    expect(organizationDeleteErrorKey({ code: 'ORGANIZATION_NOT_FOUND' })).toBeUndefined()
    expect(organizationDeleteErrorKey({})).toBeUndefined()
    expect(organizationDeleteErrorKey(new Error('network'))).toBeUndefined()
    expect(organizationDeleteErrorKey({ code: 'constructor' })).toBeUndefined()
  })

  it('has the message in every locale', () => {
    for (const locale of ['en', 'zh-CN', 'ja', 'fr'] as const)
      expect(messages[locale].dangerZone.errors.activeSubscription, locale).toBeTruthy()
  })
})
