import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubNitroGlobals } from './support/nitroGlobals'

const getAuthSession = vi.hoisted(() => vi.fn())
const findMember = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({ query: { member: { findFirst: findMember } } })
}))

beforeAll(stubNitroGlobals)

const loadBilling = () => import('~~/server/utils/billing')

describe('requireOrganizationRole', () => {
  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    findMember.mockReset().mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'owner' })
  })

  it('refuses an anonymous caller with 401', async () => {
    getAuthSession.mockResolvedValue(null)
    const { requireOrganizationRole } = await loadBilling()

    await expect(requireOrganizationRole({} as never, 'org-a', ['owner']))
      .rejects
      .toMatchObject({ statusCode: 401 })
    expect(findMember).not.toHaveBeenCalled()
  })

  it('answers the same 403 to a non-member and to a member without the required role', async () => {
    const { requireOrganizationRole } = await loadBilling()

    findMember.mockResolvedValue(undefined)
    const nonMember = await requireOrganizationRole({} as never, 'org-a', ['owner']).catch(e => e)

    findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'member' })
    const wrongRole = await requireOrganizationRole({} as never, 'org-a', ['owner']).catch(e => e)

    expect(nonMember).toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
    expect(wrongRole).toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
  })

  it('accepts any membership, multi-role values included, when no role is required', async () => {
    const { requireOrganizationRole } = await loadBilling()

    for (const role of ['owner', 'admin', 'member', 'admin,member']) {
      findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role })
      await expect(requireOrganizationRole({} as never, 'org-a')).resolves.toMatchObject({ member: { role } })
    }

    findMember.mockResolvedValue(undefined)
    await expect(requireOrganizationRole({} as never, 'org-a'))
      .rejects
      .toMatchObject({ statusCode: 403, statusMessage: 'Forbidden' })
  })

  it('looks the session up once per request when the route already required it', async () => {
    const { requireAuthSession, requireOrganizationRole } = await loadBilling()
    const event = {} as never

    await requireAuthSession(event)
    await requireOrganizationRole(event, 'org-a', ['owner'])

    expect(getAuthSession).toHaveBeenCalledTimes(1)
  })

  it('returns the session and the membership when the role is allowed', async () => {
    findMember.mockResolvedValue({ userId: 'u1', organizationId: 'org-a', role: 'admin' })
    const { requireOrganizationRole } = await loadBilling()

    const result = await requireOrganizationRole({} as never, 'org-a', ['owner', 'admin'])

    expect(result.session).toEqual({ user: { id: 'u1' } })
    expect(result.member).toMatchObject({ organizationId: 'org-a', role: 'admin' })
  })
})

describe('resolveOwnedSubscription', () => {
  const org = { id: 'org-a', stripeCustomerId: 'cus_a' }
  const ownRow = { id: 'local-1', referenceId: 'org-a', stripeSubscriptionId: 'sub_a' }
  const findSubscription = vi.fn()
  const retrieve = vi.fn()
  const update = vi.fn()
  const db = { query: { subscription: { findFirst: findSubscription } } }
  const stripe = { subscriptions: { retrieve, update } }

  const resolve = async (organization: { id: string, stripeCustomerId: string | null }, subscriptionId: string) => {
    const { resolveOwnedSubscription } = await loadBilling()
    return resolveOwnedSubscription(db as never, stripe as never, organization, subscriptionId)
  }

  beforeEach(() => {
    findSubscription.mockReset().mockResolvedValue(ownRow)
    retrieve.mockReset().mockResolvedValue({ id: 'sub_a', customer: 'cus_a' })
    update.mockReset()
  })

  it('returns the Stripe subscription when the local record and the customer both match', async () => {
    await expect(resolve(org, 'sub_a')).resolves.toEqual({ id: 'sub_a', customer: 'cus_a' })
    expect(retrieve).toHaveBeenCalledWith('sub_a')
    expect(update).not.toHaveBeenCalled()
  })

  it('looks the local record up by both the organization and the Stripe subscription id', async () => {
    await resolve(org, 'sub_a')

    const { where } = findSubscription.mock.calls[0]![0]
    const query = new PgDialect().sqlToQuery(where)
    expect(query.sql).toContain('"subscription"."reference_id" = $')
    expect(query.sql).toContain('"subscription"."stripe_subscription_id" = $')
    expect(query.sql).toMatch(/\band\b/)
    expect(query.params).toEqual(['org-a', 'sub_a'])
  })

  it('accepts an expanded customer object of the organization', async () => {
    retrieve.mockResolvedValue({ id: 'sub_a', customer: { id: 'cus_a', object: 'customer' } })

    await expect(resolve(org, 'sub_a')).resolves.toMatchObject({ id: 'sub_a' })
  })

  it('answers 404 when the organization has no local record of the subscription', async () => {
    findSubscription.mockResolvedValue(undefined)

    await expect(resolve(org, 'sub_other')).rejects.toMatchObject({ statusCode: 404 })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('answers 404 when the local record belongs to another organization', async () => {
    findSubscription.mockResolvedValue({ id: 'local-2', referenceId: 'org-b', stripeSubscriptionId: 'sub_b' })

    await expect(resolve(org, 'sub_b')).rejects.toMatchObject({ statusCode: 404 })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('answers 404 when the local record points to another Stripe subscription', async () => {
    findSubscription.mockResolvedValue({ ...ownRow, stripeSubscriptionId: 'sub_other' })

    await expect(resolve(org, 'sub_a')).rejects.toMatchObject({ statusCode: 404 })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('answers 404 when the Stripe subscription belongs to another customer', async () => {
    retrieve.mockResolvedValue({ id: 'sub_a', customer: 'cus_b' })

    await expect(resolve(org, 'sub_a')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('answers 404 when the organization has no Stripe customer', async () => {
    await expect(resolve({ id: 'org-a', stripeCustomerId: null }, 'sub_a')).rejects.toMatchObject({ statusCode: 404 })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('answers 404 when Stripe does not know the subscription', async () => {
    retrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 }))

    await expect(resolve(org, 'sub_a')).rejects.toMatchObject({ statusCode: 404, statusMessage: 'Subscription not found' })
  })

  it('lets other Stripe errors through', async () => {
    retrieve.mockRejectedValue(Object.assign(new Error('Stripe is down'), { code: 'api_error' }))

    await expect(resolve(org, 'sub_a')).rejects.toThrow('Stripe is down')
  })

  it('gives the same answer whichever check fails', async () => {
    findSubscription.mockResolvedValue(undefined)
    const missingRow = await resolve(org, 'sub_a').catch(e => e)

    findSubscription.mockResolvedValue(ownRow)
    retrieve.mockResolvedValue({ id: 'sub_a', customer: 'cus_b' })
    const foreignCustomer = await resolve(org, 'sub_a').catch(e => e)

    expect(missingRow).toMatchObject({ statusCode: 404, statusMessage: 'Subscription not found' })
    expect(foreignCustomer).toMatchObject({ statusCode: 404, statusMessage: 'Subscription not found' })
  })
})
