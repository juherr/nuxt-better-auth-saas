import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import {
  getStripeSubscriptionPeriodEnd,
  getStripeSubscriptionPeriodEndSeconds
} from '~~/server/utils/stripeSubscriptionPeriod'

// The fields of the SDK types the helper reads, so a rename in `stripe`
// breaks these fixtures at typecheck time.
type ItemFixture = Pick<Stripe.SubscriptionItem, 'id' | 'object' | 'current_period_start' | 'current_period_end'>
type SubscriptionFixture = Pick<Stripe.Subscription, 'id' | 'object' | 'status'> & {
  items: { object: 'list', data: ItemFixture[] }
}

const periodStart = 1_767_225_600 // 2026-01-01T00:00:00Z
const periodEnd = 1_769_904_000 // 2026-02-01T00:00:00Z

function subscription(items: ItemFixture[]): SubscriptionFixture {
  return { id: 'sub_1', object: 'subscription', status: 'active', items: { object: 'list', data: items } }
}

// Since API 2025-03-31.basil the period lives on the subscription items.
const currentShape = subscription([
  { id: 'si_1', object: 'subscription_item', current_period_start: periodStart, current_period_end: periodEnd }
])

// Webhook endpoints pinned before basil still send it on the subscription.
const legacyShape: SubscriptionFixture & { current_period_end: number } = {
  ...subscription([]),
  current_period_end: periodEnd
}

const noPeriod = subscription([])

describe('the period end of a Stripe subscription', () => {
  it('reads it from the first subscription item', () => {
    expect(getStripeSubscriptionPeriodEndSeconds(currentShape)).toBe(periodEnd)
    expect(getStripeSubscriptionPeriodEnd(currentShape)).toEqual(new Date('2026-02-01T00:00:00Z'))
  })

  it('falls back to the legacy top-level field', () => {
    expect(getStripeSubscriptionPeriodEndSeconds(legacyShape)).toBe(periodEnd)
    expect(getStripeSubscriptionPeriodEnd(legacyShape)).toEqual(new Date('2026-02-01T00:00:00Z'))
  })

  it('is null when neither carries it', () => {
    expect(getStripeSubscriptionPeriodEndSeconds(noPeriod)).toBeNull()
    expect(getStripeSubscriptionPeriodEnd(noPeriod)).toBeNull()
    expect(getStripeSubscriptionPeriodEnd({})).toBeNull()
  })
})
