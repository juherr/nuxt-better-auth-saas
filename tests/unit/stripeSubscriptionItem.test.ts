// SPDX-License-Identifier: MIT
import { beforeAll, describe, expect, it } from 'vitest'
import { requireSubscriptionItem } from '~~/server/utils/stripeSubscriptionItem'
import { stubNitroGlobals } from './support/nitroGlobals'

beforeAll(stubNitroGlobals)

describe('requireSubscriptionItem', () => {
  it('returns the first subscription item', () => {
    const first = { id: 'si_first', quantity: 3 }
    const subscription = { items: { data: [first, { id: 'si_second', quantity: 1 }] } }

    expect(requireSubscriptionItem(subscription)).toBe(first)
  })

  it('throws a 500 when the subscription has no item', () => {
    expect(() => requireSubscriptionItem({ items: { data: [] } }))
      .toThrow(expect.objectContaining({ statusCode: 500 }))
  })
})
