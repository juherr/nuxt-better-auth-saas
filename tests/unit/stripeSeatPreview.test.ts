import type { FakeSubscription } from './support/stripeSubscriptionsFake'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTierForInterval } from '~~/shared/utils/plans'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'
import { fakeSubscription, stripeSubscriptionsFake } from './support/stripeSubscriptionsFake'

const createStripeClient = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/auth', () => ({ getAuthSession: vi.fn() }))
vi.mock('~~/server/utils/billing', async importActual => ({
  ...(await importActual<typeof import('~~/server/utils/billing')>()),
  requireAuthSession: vi.fn(async () => ({ user: { id: 'u1' } })),
  requireOrganizationRole: vi.fn(async () => ({}))
}))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      organization: { findFirst: async () => ({ id: 'org-a', stripeCustomerId: 'cus_a' }) },
      // No local row: the subscription is listed from Stripe and priced as pro.
      subscription: { findFirst: async () => undefined, findMany: async () => [] }
    }
  })
}))
vi.mock('~~/server/utils/stripe', () => ({ createStripeClient }))

beforeAll(stubNitroGlobals)

const load = () => import('~~/server/api/stripe/preview-seat-change.post')

/** A trialing subscription as Stripe returns it today: no legacy `plan` field. */
function trialingSubscription(recurring: { interval: string } | null): FakeSubscription {
  const subscription = fakeSubscription('sub_trial', 'trialing')
  expect(subscription).not.toHaveProperty('plan')
  subscription.items.data[0]!.price.recurring = recurring as { interval: string }
  return subscription
}

function stubStripe(subscription: FakeSubscription) {
  const createPreview = vi.fn()
  createStripeClient.mockReturnValue({
    subscriptions: stripeSubscriptionsFake({ pages: [[subscription]] }),
    invoices: { createPreview },
    paymentMethods: { retrieve: vi.fn(async () => ({ card: null })) }
  })
  return { createPreview }
}

describe('the preview-seat-change endpoint on a trialing subscription', () => {
  beforeEach(() => {
    createStripeClient.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('prices the preview with the item price interval when no newInterval is sent', async () => {
    const { createPreview } = stubStripe(trialingSubscription({ interval: 'year' }))
    const yearly = getTierForInterval('pro', 'year')

    const preview = await callRoute<{ total: number, periodEnd: number }>(
      load,
      { organizationId: 'org-a', seats: 2 }
    )

    expect(preview.total).toBe(Math.round((yearly.price + yearly.seatPrice) * 100))
    expect(preview.periodEnd).toBeGreaterThan(Math.floor(Date.now() / 1000) + 31_000_000)
    expect(createPreview).not.toHaveBeenCalled()
  })

  it('fails explicitly when the item price has no recurring interval', async () => {
    stubStripe(trialingSubscription(null))

    const outcome = await callRoute(load, { organizationId: 'org-a', seats: 2 })
      .then(() => undefined, (error: unknown) => error)

    expect(outcome).toMatchObject({ statusCode: 500, statusMessage: 'Subscription price has no billing interval' })
  })
})
