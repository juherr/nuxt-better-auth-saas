// SPDX-License-Identifier: MIT
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const getAuthSession = vi.hoisted(() => vi.fn())
const findMember = vi.hoisted(() => vi.fn())
const findOrganization = vi.hoisted(() => vi.fn())
const findSubscription = vi.hoisted(() => vi.fn())
const retrieveSubscription = vi.hoisted(() => vi.fn())
const updateSubscription = vi.hoisted(() => vi.fn())

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
vi.mock('~~/server/utils/stripe', () => ({
  createStripeClient: () => ({
    subscriptions: { retrieve: retrieveSubscription, update: updateSubscription }
  }),
  addPaymentLog: vi.fn()
}))
vi.mock('~~/server/utils/stripeEmails', () => ({ sendSubscriptionResumedEmail: vi.fn() }))

beforeAll(stubNitroGlobals)

// Organization A is the caller's; B is another organization with its own customer.
const orgA = { id: 'org-a', stripeCustomerId: 'cus_a' }
const subA = { id: 'sub_a', customer: 'cus_a' }
const subB = { id: 'sub_b', customer: 'cus_b' }

const routes = {
  cancel: { load: () => import('~~/server/api/stripe/cancel.post'), cancelAtPeriodEnd: true },
  resume: { load: () => import('~~/server/api/stripe/resume.post'), cancelAtPeriodEnd: false }
}

describe.each(Object.entries(routes))('the %s subscription endpoint', (_name, route) => {
  const call = (body: Record<string, unknown>) => callRoute<{ success: boolean, subscription: unknown }>(route.load, body)

  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset().mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'owner' })
    findOrganization.mockReset().mockResolvedValue(orgA)
    findSubscription.mockReset().mockResolvedValue({ id: 'local-a', referenceId: 'org-a', stripeSubscriptionId: 'sub_a' })
    retrieveSubscription.mockReset().mockImplementation(async (id: string) => (id === 'sub_b' ? subB : subA))
    updateSubscription.mockReset().mockImplementation(async (id: string, params: object) => ({ id, ...params }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('lets the owner update the organization\'s own subscription', async () => {
    const result = await call({ subscriptionId: 'sub_a', referenceId: 'org-a' })

    expect(result).toEqual({ success: true, subscription: { id: 'sub_a', cancel_at_period_end: route.cancelAtPeriodEnd } })
    expect(updateSubscription).toHaveBeenCalledWith('sub_a', { cancel_at_period_end: route.cancelAtPeriodEnd })
  })

  it('answers 404 for a subscription the organization has no record of, without updating it', async () => {
    findSubscription.mockResolvedValue(undefined)

    await expect(call({ subscriptionId: 'sub_b', referenceId: 'org-a' })).rejects.toMatchObject({ statusCode: 404 })
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it('answers 404 for a subscription billed to another customer, without updating it', async () => {
    findSubscription.mockResolvedValue({ id: 'local-x', referenceId: 'org-a', stripeSubscriptionId: 'sub_b' })

    await expect(call({ subscriptionId: 'sub_b', referenceId: 'org-a' })).rejects.toMatchObject({ statusCode: 404 })
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it('refuses a member who is not the owner with 403, without updating', async () => {
    findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'member' })

    await expect(call({ subscriptionId: 'sub_a', referenceId: 'org-a' })).rejects.toMatchObject({ statusCode: 403 })
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it('refuses a user outside the organization with 403, without updating', async () => {
    findMember.mockResolvedValue(undefined)

    await expect(call({ subscriptionId: 'sub_a', referenceId: 'org-a' })).rejects.toMatchObject({ statusCode: 403 })
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it('answers 404 when the organization no longer exists, without reaching Stripe', async () => {
    findOrganization.mockResolvedValue(undefined)

    await expect(call({ subscriptionId: 'sub_a', referenceId: 'org-a' })).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Subscription not found' })
    expect(retrieveSubscription).not.toHaveBeenCalled()
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it('refuses an anonymous request with 401, without updating', async () => {
    getAuthSession.mockResolvedValue(null)

    await expect(call({ subscriptionId: 'sub_a', referenceId: 'org-a' })).rejects.toMatchObject({ statusCode: 401 })
    expect(updateSubscription).not.toHaveBeenCalled()
  })

  it.each([
    ['the subscription id', { referenceId: 'org-a' }],
    ['the organization id', { subscriptionId: 'sub_a' }]
  ])('answers 400 when %s is missing', async (_label, body) => {
    await expect(call(body)).rejects.toMatchObject({ statusCode: 400 })
    expect(updateSubscription).not.toHaveBeenCalled()
  })
})
