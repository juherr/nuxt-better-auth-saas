import type { StripeSubscriptionsState } from './support/stripeSubscriptionsFake'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubNitroGlobals } from './support/nitroGlobals'
import { fakeSubscription, stripeSubscriptionsFake } from './support/stripeSubscriptionsFake'

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

describe('chooseSingleSubscription', () => {
  const loadChoose = async () => (await loadBilling()).chooseSingleSubscription

  it('reports none when there is no candidate', async () => {
    const choose = await loadChoose()
    expect(choose([])).toEqual({ outcome: 'none' })
  })

  it('returns the only candidate, counting duplicates of one id once', async () => {
    const choose = await loadChoose()
    const sub = { id: 'sub_a' }
    expect(choose([sub, { id: 'sub_a' }])).toEqual({ outcome: 'one', subscription: sub })
  })

  it('reports many when two distinct subscriptions qualify, without picking one', async () => {
    const choose = await loadChoose()
    expect(choose([{ id: 'sub_a' }, { id: 'sub_b' }])).toEqual({ outcome: 'many' })
  })
})

describe('selectActiveSubscription', () => {
  const org = { id: 'org-a', stripeCustomerId: 'cus_a' }
  const findRows = vi.fn()
  const db = { query: { subscription: { findMany: findRows } } }
  const row = (stripeSubscriptionId: string | null, status = 'active', referenceId = 'org-a') =>
    ({ id: `local-${stripeSubscriptionId}`, referenceId, status, stripeSubscriptionId })

  const stripeWith = (state: StripeSubscriptionsState) => {
    const fake = stripeSubscriptionsFake(state)
    const subscriptions = { retrieve: vi.fn(fake.retrieve), list: vi.fn(fake.list) }
    return { subscriptions }
  }

  const select = async (stripe: ReturnType<typeof stripeWith>, organization: { id: string, stripeCustomerId: string | null } = org) => {
    const { selectActiveSubscription } = await loadBilling()
    return selectActiveSubscription(stripe as never, db as never, organization)
  }

  beforeEach(() => {
    findRows.mockReset().mockResolvedValue([])
  })

  it('finds the active subscription listed after a canceled one', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_old', 'canceled'), fakeSubscription('sub_new', 'active')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_new' })
  })

  it('prefers the local record of the active subscription over a canceled one', async () => {
    findRows.mockResolvedValue([row('sub_old', 'canceled'), row('sub_new')])
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_old', 'canceled'), fakeSubscription('sub_new', 'active')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_new' })
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_new')
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalledWith('sub_old')
    expect(stripe.subscriptions.list).not.toHaveBeenCalled()
  })

  it('selects a trialing subscription', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_trial', 'trialing')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_trial', status: 'trialing' })
  })

  it('answers 400 when no subscription is active or trialing', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_old', 'canceled')]] })

    await expect(select(stripe)).rejects.toMatchObject({ statusCode: 400, statusMessage: 'No active subscription found' })
  })

  it('answers 409 when several subscriptions are active, without picking one', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_1', 'active'), fakeSubscription('sub_2', 'trialing')]] })

    await expect(select(stripe)).rejects.toMatchObject({ statusCode: 409, statusMessage: 'Multiple active subscriptions' })
  })

  it('answers 409 when two local records verify, without falling back to the list', async () => {
    findRows.mockResolvedValue([row('sub_1'), row('sub_2', 'trialing')])
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_1', 'active'), fakeSubscription('sub_2', 'trialing')]] })

    await expect(select(stripe)).rejects.toMatchObject({ statusCode: 409 })
    expect(stripe.subscriptions.list).not.toHaveBeenCalled()
  })

  it('finds the active subscription on the second page of the list', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_old', 'canceled')], [fakeSubscription('sub_page2', 'active')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_page2' })
  })

  it('ignores a local record billed to another customer and falls back to the list', async () => {
    findRows.mockResolvedValue([row('sub_foreign')])
    const stripe = stripeWith({
      pages: [[fakeSubscription('sub_own', 'active')]],
      elsewhere: [fakeSubscription('sub_foreign', 'active', 'cus_b')]
    })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_own' })
  })

  it('ignores a local record whose Stripe subscription is no longer active', async () => {
    findRows.mockResolvedValue([row('sub_old')])
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_old', 'canceled'), fakeSubscription('sub_new', 'active')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_new' })
  })

  it('ignores a local record of another organization', async () => {
    findRows.mockResolvedValue([row('sub_b', 'active', 'org-b')])
    const stripe = stripeWith({ pages: [[]], elsewhere: [fakeSubscription('sub_b', 'active')] })

    await expect(select(stripe)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('treats a local record Stripe does not know as no candidate', async () => {
    findRows.mockResolvedValue([row('sub_gone')])
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_new', 'active')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_new' })
  })

  it('lets other Stripe errors through', async () => {
    findRows.mockResolvedValue([row('sub_a')])
    const stripe = stripeWith({ pages: [[]] })
    stripe.subscriptions.retrieve.mockRejectedValue(Object.assign(new Error('Stripe is down'), { code: 'api_error' }))

    await expect(select(stripe)).rejects.toThrow('Stripe is down')
  })

  it('skips records without a Stripe id and retrieves a duplicated id once', async () => {
    findRows.mockResolvedValue([row(null), row('sub_a'), row('sub_a')])
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_a', 'active')]] })

    await expect(select(stripe)).resolves.toMatchObject({ id: 'sub_a' })
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1)
  })

  it('answers 400 without calling Stripe when the organization has no Stripe customer', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_a', 'active')]] })

    await expect(select(stripe, { id: 'org-a', stripeCustomerId: null })).rejects.toMatchObject({ statusCode: 400 })
    expect(stripe.subscriptions.list).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  it('looks the local records up by organization and active or trialing status', async () => {
    await select(stripeWith({ pages: [[fakeSubscription('sub_a', 'active')]] }))

    const { where } = findRows.mock.calls[0]![0]
    const query = new PgDialect().sqlToQuery(where)
    expect(query.sql).toContain('"subscription"."reference_id" = $')
    expect(query.sql).toContain('"subscription"."status" in ($')
    expect(query.params).toEqual(['org-a', 'active', 'trialing'])
  })

  it('lists active and trialing subscriptions of the organization\'s customer', async () => {
    const stripe = stripeWith({ pages: [[fakeSubscription('sub_a', 'active')]] })

    await select(stripe)

    expect(stripe.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus_a', status: 'active' })
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({ customer: 'cus_a', status: 'trialing' })
  })
})
