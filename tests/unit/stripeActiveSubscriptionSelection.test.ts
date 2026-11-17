import type { DownstreamStripe, SelectionRouteAdapter } from './support/subscriptionSelectionCases'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'
import { stripeSubscriptionsFake } from './support/stripeSubscriptionsFake'
import { selectionCases } from './support/subscriptionSelectionCases'

const findOrganization = vi.hoisted(() => vi.fn())
const findSubscriptionRows = vi.hoisted(() => vi.fn())
const findSubscription = vi.hoisted(() => vi.fn())
const createStripeClient = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/auth', () => ({ getAuthSession: vi.fn() }))
// The access checks are covered elsewhere; the selection runs for real.
vi.mock('~~/server/utils/billing', async importActual => ({
  ...(await importActual<typeof import('~~/server/utils/billing')>()),
  requireAuthSession: vi.fn(async () => ({ user: { id: 'u1' } })),
  requireOrganizationRole: vi.fn(async () => ({}))
}))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      organization: { findFirst: findOrganization },
      subscription: { findFirst: findSubscription, findMany: findSubscriptionRows }
    },
    update: () => ({ set: () => ({ where: async () => undefined }) })
  })
}))
vi.mock('~~/server/utils/stripe', () => ({ createStripeClient }))
vi.mock('~~/server/utils/stripeEmails', () => ({ sendSubscriptionUpdatedEmail: vi.fn() }))

beforeAll(stubNitroGlobals)

const routes: Record<string, SelectionRouteAdapter> = {
  'change-plan': {
    load: () => import('~~/server/api/stripe/change-plan.post'),
    // Without a local plan the current tier is free, so this is an upgrade.
    body: { organizationId: 'org-a', newInterval: 'month', newTierKey: 'business' },
    downstream: () => ({
      subscriptions: { update: vi.fn(async (id: string) => ({ id, status: 'active', trial_end: null })) }
    }),
    selectedId: stripe => (stripe.subscriptions!.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
  },
  'preview-tier-change': {
    load: () => import('~~/server/api/stripe/preview-tier-change.post'),
    // An unknown current price counts as pro, so business is an upgrade.
    body: { organizationId: 'org-a', newTierKey: 'business', newInterval: 'month' },
    downstream: () => ({
      invoices: { createPreview: vi.fn(async () => ({ lines: { data: [] } })) },
      paymentMethods: { retrieve: vi.fn(async () => ({ card: null })) }
    }),
    // A trialing subscription returns before the invoice preview; its
    // payment method (`pm_<subscription id>`) is read on both paths.
    selectedId: (stripe) => {
      const preview = (stripe.invoices!.createPreview as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      const paymentMethod: string | undefined = (stripe.paymentMethods!.retrieve as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      return preview?.subscription ?? paymentMethod?.replace(/^pm_/, '')
    }
  }
}

describe.each(Object.entries(routes))('the %s endpoint', (_name, route) => {
  beforeEach(() => {
    findOrganization.mockReset().mockResolvedValue({ id: 'org-a', stripeCustomerId: 'cus_a' })
    findSubscription.mockReset().mockResolvedValue(undefined)
    findSubscriptionRows.mockReset()
    createStripeClient.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it.each(selectionCases)('selects the subscription for $name', async (selectionCase) => {
    findSubscriptionRows.mockResolvedValue(selectionCase.localRows)
    const downstream: DownstreamStripe = route.downstream()
    createStripeClient.mockReturnValue({
      ...downstream,
      subscriptions: { ...stripeSubscriptionsFake(selectionCase.stripe), ...downstream.subscriptions }
    })

    const outcome = await callRoute(route.load, route.body).then(() => undefined, (error: unknown) => error)

    if ('selected' in selectionCase.expected) {
      expect(outcome).toBeUndefined()
      expect(route.selectedId(downstream)).toBe(selectionCase.expected.selected)
    } else {
      expect(outcome).toMatchObject(selectionCase.expected)
      expect(route.selectedId(downstream)).toBeUndefined()
    }
  })
})
