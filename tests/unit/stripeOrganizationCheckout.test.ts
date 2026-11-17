import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  stripeSecretKey: 'sk_test_canary' as string | undefined,
  stripeWebhookSecret: 'whsec_canary',
  public: { baseURL: 'https://saas.example.test' }
}))
const findOrganization = vi.hoisted(() => vi.fn())
const pluginOptions = vi.hoisted(() => ({ current: undefined as any }))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({ query: { organization: { findFirst: findOrganization } } })
}))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))
vi.mock('~~/server/utils/stripeEmails', () => ({}))
vi.mock('~~/server/utils/subscription-handlers', () => ({ removeExcessMembersOnExpiration: vi.fn() }))
vi.mock('@better-auth/stripe', () => ({
  stripe: (options: unknown) => {
    pluginOptions.current = options
    return { id: 'stripe' }
  }
}))

const orgWithSeats = {
  id: 'org-1',
  stripeCustomerId: 'cus_org',
  members: [{ id: 'm1' }, { id: 'm2' }],
  invitations: [{ status: 'pending' }, { status: 'accepted' }, { status: 'pending' }]
}

describe('the organization upgrade request', () => {
  it('bills the organization as a Stripe organization customer', async () => {
    const { buildOrganizationUpgrade } = await import('~~/app/utils/subscriptionUpgrade')
    expect(buildOrganizationUpgrade({
      plan: 'pro-monthly',
      organizationId: 'org-1',
      successUrl: 'https://saas.example.test/acme/billing?upgraded=true',
      cancelUrl: 'https://saas.example.test/acme/billing'
    })).toEqual({
      plan: 'pro-monthly',
      customerType: 'organization',
      referenceId: 'org-1',
      successUrl: 'https://saas.example.test/acme/billing?upgraded=true',
      cancelUrl: 'https://saas.example.test/acme/billing'
    })
  })

  it('keeps the metadata it is given', async () => {
    const { buildOrganizationUpgrade } = await import('~~/app/utils/subscriptionUpgrade')
    expect(buildOrganizationUpgrade({
      plan: 'pro-yearly',
      organizationId: 'org-1',
      successUrl: '/ok',
      cancelUrl: '/ko',
      metadata: { quantity: 3 }
    })).toMatchObject({ metadata: { quantity: 3 } })
  })
})

describe('the stripe plugin options', () => {
  beforeEach(async () => {
    findOrganization.mockReset().mockResolvedValue(orgWithSeats)
    const { setupStripe } = await import('~~/server/utils/stripe')
    setupStripe()
  })

  it('enables organization customers', () => {
    expect(pluginOptions.current.organization).toEqual({ enabled: true })
  })

  it('keeps the base checkout params the plugin does not override', async () => {
    const { params } = await pluginOptions.current.subscription.getCheckoutSessionParams(
      { session: { activeOrganizationId: 'org-1' }, plan: { priceId: 'price_pro' } },
      { body: { referenceId: 'org-1', metadata: { quantity: 3 } } }
    )
    expect(params).toEqual({
      allow_promotion_codes: true,
      tax_id_collection: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { name: 'auto', address: 'auto' },
      metadata: { quantity: 3, organizationId: 'org-1' }
    })
  })
})

describe('the server-side checkout seats', () => {
  beforeEach(() => {
    findOrganization.mockReset().mockResolvedValue(orgWithSeats)
  })

  it('counts members and pending invitations', async () => {
    const { resolveCheckoutSeats } = await import('~~/server/utils/stripe')
    expect(await resolveCheckoutSeats('org-1')).toBe(4)
  })

  it('bills at least one seat', async () => {
    findOrganization.mockResolvedValue({ ...orgWithSeats, members: [], invitations: [] })
    const { resolveCheckoutSeats } = await import('~~/server/utils/stripe')
    expect(await resolveCheckoutSeats('org-1')).toBe(1)
  })

  it('bills one seat for an unknown organization', async () => {
    findOrganization.mockResolvedValue(undefined)
    const { resolveCheckoutSeats } = await import('~~/server/utils/stripe')
    expect(await resolveCheckoutSeats('org-x')).toBe(1)
  })

  it('replaces the seats of an organization upgrade with the server count', async () => {
    const { checkoutSeatsOverride } = await import('~~/server/utils/stripe')
    const body = { plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 1 }
    expect(await checkoutSeatsOverride({ path: '/subscription/upgrade', body }))
      .toEqual({ context: { body: { ...body, seats: 4 } } })
  })

  it('leaves other requests untouched', async () => {
    const { checkoutSeatsOverride } = await import('~~/server/utils/stripe')
    expect(await checkoutSeatsOverride({ path: '/subscription/cancel', body: { customerType: 'organization', referenceId: 'org-1' } }))
      .toBeUndefined()
    expect(await checkoutSeatsOverride({ path: '/subscription/upgrade', body: { plan: 'pro-monthly' } }))
      .toBeUndefined()
    expect(findOrganization).not.toHaveBeenCalled()
  })
})
