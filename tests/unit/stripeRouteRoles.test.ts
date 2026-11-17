import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const getAuthSession = vi.hoisted(() => vi.fn())
const findMember = vi.hoisted(() => vi.fn())
const createStripeClient = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({ query: { member: { findFirst: findMember } } })
}))
vi.mock('~~/server/utils/stripe', () => ({ createStripeClient }))
vi.mock('~~/server/utils/stripeEmails', () => ({}))

beforeAll(stubNitroGlobals)

const ownerOnly = {
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
const anyMember = {
  'invoices': {
    load: () => import('~~/server/api/stripe/invoices.get'),
    query: { organizationId: 'org-a' }
  },
  'credit-balance': {
    load: () => import('~~/server/api/stripe/credit-balance.get'),
    query: { organizationId: 'org-a' }
  }
}

const call = (route: { load: () => Promise<{ default: unknown }>, body?: unknown, query?: Record<string, unknown> }) =>
  callRoute(route.load, route.body, route.query)

describe('billing routes', () => {
  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset()
    createStripeClient.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
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
})
