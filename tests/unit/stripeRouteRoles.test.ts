// SPDX-License-Identifier: MIT
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const getAuthSession = vi.hoisted(() => vi.fn())
const findMember = vi.hoisted(() => vi.fn())
const findOrganization = vi.hoisted(() => vi.fn())
const findSubscription = vi.hoisted(() => vi.fn())
const createStripeClient = vi.hoisted(() => vi.fn())
const syncStripeCustomerName = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/runtimeConfig', () => ({
  runtimeConfig: { public: { baseURL: 'https://saas.example.test' } }
}))
vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      member: { findFirst: findMember },
      organization: { findFirst: findOrganization },
      subscription: { findFirst: findSubscription }
    }
  })
}))
vi.mock('~~/server/utils/stripe', () => ({ createStripeClient, syncStripeCustomerName, addPaymentLog: vi.fn() }))
vi.mock('~~/server/utils/stripeEmails', () => ({}))

beforeAll(stubNitroGlobals)

interface Route {
  load: () => Promise<{ default: unknown }>
  body?: unknown
  query?: Record<string, unknown>
}

const ownerOnly: Record<string, Route> = {
  'change-plan': {
    load: () => import('~~/server/api/stripe/change-plan.post'),
    body: { organizationId: 'org-a', newInterval: 'month', newTierKey: 'pro' }
  },
  'preview-seat-change': {
    load: () => import('~~/server/api/stripe/preview-seat-change.post'),
    body: { organizationId: 'org-a', seats: 2 }
  },
  'preview-tier-change': {
    load: () => import('~~/server/api/stripe/preview-tier-change.post'),
    body: { organizationId: 'org-a', newTierKey: 'pro', newInterval: 'month' }
  },
  'update-seats': {
    load: () => import('~~/server/api/stripe/update-seats.post'),
    body: { organizationId: 'org-a', seats: 2 }
  }
}
const anyMember: Record<string, Route> = {
  'invoices': {
    load: () => import('~~/server/api/stripe/invoices.get'),
    query: { organizationId: 'org-a' }
  },
  'credit-balance': {
    load: () => import('~~/server/api/stripe/credit-balance.get'),
    query: { organizationId: 'org-a' }
  },
  'portal': {
    load: () => import('~~/server/api/stripe/portal.post'),
    body: { organizationId: 'org-a' }
  }
}
const subscriptionActions: Record<string, Route> = {
  cancel: { load: () => import('~~/server/api/stripe/cancel.post') },
  resume: { load: () => import('~~/server/api/stripe/resume.post') }
}
const syncCustomerName = () => import('~~/server/api/stripe/sync-customer-name.post')
const allRoutes = Object.entries({ ...ownerOnly, ...anyMember, ...subscriptionActions, 'sync-customer-name': { load: syncCustomerName } })

const call = (route: Route) => callRoute(route.load, route.body, route.query)

/** Thrown by the Stripe client factory: reaching it means the request passed the gate. */
const reachedStripe = Object.assign(new Error('reached Stripe'), { statusCode: 599 })

describe('billing routes', () => {
  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset()
    findOrganization.mockReset().mockResolvedValue({ id: 'org-a', slug: 'acme', stripeCustomerId: 'cus_a' })
    findSubscription.mockReset().mockResolvedValue(undefined)
    createStripeClient.mockReset().mockImplementation(() => {
      throw reachedStripe
    })
    syncStripeCustomerName.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe.each(allRoutes)('%s', (_name, route) => {
    it('refuses an anonymous request without a body or query with 401, before reading it', async () => {
      getAuthSession.mockResolvedValue(null)

      await expect(callRoute(route.load, undefined)).rejects.toMatchObject({ statusCode: 401 })
      expect(findMember).not.toHaveBeenCalled()
      expect(createStripeClient).not.toHaveBeenCalled()
      expect(syncStripeCustomerName).not.toHaveBeenCalled()
    })

    it('answers a signed-in request without a body or query with 400', async () => {
      await expect(callRoute(route.load, undefined)).rejects.toMatchObject({ statusCode: 400 })
      expect(createStripeClient).not.toHaveBeenCalled()
    })
  })

  describe.each(Object.entries({ ...ownerOnly, ...anyMember }))('%s', (_name, route) => {
    it('refuses an anonymous request with 401, without calling Stripe', async () => {
      getAuthSession.mockResolvedValue(null)

      await expect(call(route)).rejects.toMatchObject({ statusCode: 401 })
      expect(createStripeClient).not.toHaveBeenCalled()
    })

    it('refuses a user outside the organization with 403, without calling Stripe', async () => {
      findMember.mockResolvedValue(undefined)

      await expect(call(route)).rejects.toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
      expect(createStripeClient).not.toHaveBeenCalled()
    })
  })

  it.each(Object.entries(ownerOnly))('%s refuses a member who is not the owner with 403, without calling Stripe', async (_name, route) => {
    findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'admin' })

    await expect(call(route)).rejects.toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(createStripeClient).not.toHaveBeenCalled()
  })

  describe.each(Object.entries(anyMember))('%s', (_name, route) => {
    it.each(['owner', 'admin', 'member', 'admin,member'])('lets a member with role "%s" through to Stripe', async (role) => {
      findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role })

      await expect(call(route)).rejects.toBe(reachedStripe)
      expect(createStripeClient).toHaveBeenCalled()
      expect(getAuthSession).toHaveBeenCalledTimes(1)
    })
  })
})

describe('sync-customer-name', () => {
  const body = { organizationId: 'org-a', name: 'Acme' }

  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset()
    findOrganization.mockReset().mockResolvedValue({ id: 'org-a', stripeCustomerId: 'cus_a' })
    syncStripeCustomerName.mockReset()
  })

  it('answers a non-member the same 403 whether or not the organization exists, without loading it', async () => {
    findMember.mockResolvedValue(undefined)

    findOrganization.mockResolvedValue(undefined)
    const missing = await callRoute(syncCustomerName, { ...body, organizationId: 'org-missing' }).catch(e => e)
    findOrganization.mockResolvedValue({ id: 'org-a', stripeCustomerId: 'cus_a' })
    const existing = await callRoute(syncCustomerName, body).catch(e => e)

    expect(missing).toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(existing).toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(findOrganization).not.toHaveBeenCalled()
    expect(syncStripeCustomerName).not.toHaveBeenCalled()
  })

  it('refuses a member who is not the owner with 403, without calling Stripe', async () => {
    findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'admin' })

    await expect(callRoute(syncCustomerName, body)).rejects.toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(syncStripeCustomerName).not.toHaveBeenCalled()
  })

  it('syncs the customer name for the owner', async () => {
    findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'owner' })

    await expect(callRoute(syncCustomerName, body)).resolves.toEqual({ success: true })
    expect(syncStripeCustomerName).toHaveBeenCalledWith('org-a', 'Acme')
  })
})
