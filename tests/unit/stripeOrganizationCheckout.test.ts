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
})

describe('the billable seat count', () => {
  it('is zero without members or invitations', async () => {
    const { countBillableSeats } = await import('~~/server/utils/stripe')
    expect(countBillableSeats({ members: [], invitations: [] })).toEqual({ total: 0, members: 0, pendingInvitations: 0 })
  })

  it('ignores invitations that are not pending', async () => {
    const { countBillableSeats } = await import('~~/server/utils/stripe')
    const seats = countBillableSeats({ members: [], invitations: [{ status: 'accepted' }, { status: 'canceled' }] })
    expect(seats).toEqual({ total: 0, members: 0, pendingInvitations: 0 })
  })

  it('sums members and pending invitations', async () => {
    const { countBillableSeats } = await import('~~/server/utils/stripe')
    expect(countBillableSeats(orgWithSeats)).toEqual({ total: 4, members: 2, pendingInvitations: 2 })
  })
})

const origin = 'https://saas.example.test'
const secret = 'canary-secret-canary-secret-canary-secret'

// A signed-up user whose sessions carry `activeOrganizationId`, as the
// organization plugin would set it.
async function signedInInstance(options: {
  activeOrganizationId?: string
  withHook?: boolean
  plugins: any[]
  databaseTables?: string[]
}) {
  const { betterAuth } = await import('better-auth')
  const { memoryAdapter } = await import('better-auth/adapters/memory')
  const { checkoutSeatsHook } = await import('~~/server/utils/stripe')
  const tables = ['user', 'session', 'account', 'verification', ...(options.databaseTables ?? [])]
  const auth = betterAuth({
    secret,
    baseURL: origin,
    database: memoryAdapter(Object.fromEntries(tables.map(table => [table, []]))),
    emailAndPassword: { enabled: true },
    session: {
      additionalFields: { activeOrganizationId: { type: 'string', required: false, input: false } }
    },
    databaseHooks: {
      session: {
        create: {
          before: async session => ({ data: { ...session, activeOrganizationId: options.activeOrganizationId ?? null } })
        }
      }
    },
    ...(options.withHook === false ? {} : { hooks: { before: checkoutSeatsHook } }),
    plugins: options.plugins
  })
  const { headers, response } = await auth.api.signUpEmail({
    body: { email: 'owner@example.test', password: 'canary-password-123', name: 'Owner' },
    returnHeaders: true
  })
  const cookie = headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const post = (path: string, body: unknown, withCookie = true) => auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body)
  }))
  return { post, userId: response.user.id }
}

// Runs the hook through better-auth's real dispatch, with stand-ins for the
// stripe endpoints that echo the body they receive.
describe('the checkout seats hook in a better-auth instance', () => {
  async function echoPlugin() {
    const { createAuthEndpoint } = await import('better-auth/api')
    const { z } = await import('zod')
    const schema = {
      method: 'POST' as const,
      body: z.object({
        plan: z.string().optional(),
        customerType: z.string().optional(),
        referenceId: z.string().optional(),
        seats: z.number().optional()
      }),
      query: z.object({
        customerType: z.string().optional(),
        referenceId: z.string().optional()
      }).optional()
    }
    return {
      id: 'stripe-echo',
      endpoints: {
        upgradeEcho: createAuthEndpoint('/subscription/upgrade', schema, async ctx => ctx.json(ctx.body)),
        cancelEcho: createAuthEndpoint('/subscription/cancel', schema, async ctx => ctx.json(ctx.body))
      }
    }
  }

  async function bodySeenByUpgrade(body: object, options: { activeOrganizationId?: string, withHook?: boolean, query?: string } = {}) {
    const { post, userId } = await signedInInstance({ ...options, plugins: [await echoPlugin()] })
    const response = await post(`/subscription/upgrade${options.query ?? ''}`, body)
    expect(response.status).toBe(200)
    return { seen: await response.json(), userId }
  }

  beforeEach(() => {
    findOrganization.mockReset().mockResolvedValue(orgWithSeats)
  })

  it('hands the server seat count to an organization upgrade', async () => {
    const { seen } = await bodySeenByUpgrade({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 1 })
    expect(seen).toEqual({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 4 })
  })

  it('would pass the client seats through without the hook', async () => {
    const { seen } = await bodySeenByUpgrade({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 1 }, { withHook: false })
    expect(seen).toMatchObject({ seats: 1 })
  })

  it('bills an organization reference as an organization when customerType is omitted', async () => {
    const { seen } = await bodySeenByUpgrade({ plan: 'pro-monthly', referenceId: 'org-1', seats: 50 })
    expect(seen).toEqual({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 4 })
  })

  it('bills an organization reference as an organization when customerType is user', async () => {
    const { seen } = await bodySeenByUpgrade({ plan: 'pro-monthly', customerType: 'user', referenceId: 'org-1', seats: 50 })
    expect(seen).toEqual({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 4 })
  })

  it('bills the active organization when referenceId is omitted', async () => {
    const { seen } = await bodySeenByUpgrade({ plan: 'pro-monthly', seats: 50 }, { activeOrganizationId: 'org-1' })
    expect(seen).toEqual({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-1', seats: 4 })
    expect(findOrganization).toHaveBeenCalled()
  })

  it('reads the reference from the query as the stripe plugin does', async () => {
    const { seen } = await bodySeenByUpgrade(
      { plan: 'pro-monthly', seats: 50 },
      { query: '?customerType=organization&referenceId=org-2' }
    )
    expect(seen).toEqual({ plan: 'pro-monthly', customerType: 'organization', referenceId: 'org-2', seats: 4 })
  })

  it('bills one seat to a user subscription, whatever the client sends', async () => {
    const { seen } = await bodySeenByUpgrade({ plan: 'pro-monthly', seats: 50 })
    expect(seen).toEqual({ plan: 'pro-monthly', customerType: 'user', seats: 1 })
    expect(findOrganization).not.toHaveBeenCalled()
  })

  it('keeps the user\'s own id as a user subscription', async () => {
    const { post, userId } = await signedInInstance({ activeOrganizationId: 'org-1', plugins: [await echoPlugin()] })
    const response = await post('/subscription/upgrade', { plan: 'pro-monthly', customerType: 'organization', referenceId: userId, seats: 9 })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ plan: 'pro-monthly', customerType: 'user', referenceId: userId, seats: 1 })
    expect(findOrganization).not.toHaveBeenCalled()
  })

  it('leaves other endpoints untouched', async () => {
    const { post } = await signedInInstance({ plugins: [await echoPlugin()] })
    const body = { customerType: 'user', referenceId: 'org-1', seats: 50 }
    const response = await post('/subscription/cancel', body)
    expect(await response.json()).toEqual(body)
    expect(findOrganization).not.toHaveBeenCalled()
  })
})

// The real stripe plugin behind the hook: its referenceMiddleware must still
// ask authorizeReference about the reference the hook settled on.
describe('the checkout seats hook in front of the stripe plugin', () => {
  async function stripePlugin(authorizeReference: (...args: any[]) => Promise<boolean>) {
    const { stripe } = await vi.importActual<typeof import('@better-auth/stripe')>('@better-auth/stripe')
    return stripe({
      stripeClient: {} as any,
      stripeWebhookSecret: 'whsec_canary',
      organization: { enabled: true },
      subscription: { enabled: true, plans: [], authorizeReference }
    })
  }

  beforeEach(() => {
    findOrganization.mockReset().mockResolvedValue(orgWithSeats)
  })

  it('still runs authorizeReference on the organization reference', async () => {
    const authorizeReference = vi.fn(async () => false)
    const { post } = await signedInInstance({
      plugins: [await stripePlugin(authorizeReference)],
      databaseTables: ['subscription', 'organization']
    })
    const response = await post('/subscription/upgrade', { plan: 'pro-monthly', customerType: 'user', referenceId: 'org-1', seats: 50 })
    expect(response.status).toBe(401)
    expect(authorizeReference).toHaveBeenCalledWith(
      expect.objectContaining({ referenceId: 'org-1', action: 'upgrade-subscription' }),
      expect.objectContaining({ body: expect.objectContaining({ customerType: 'organization', seats: 4 }) })
    )
  })

  it('lets the plugin reject an upgrade without a session', async () => {
    const authorizeReference = vi.fn(async () => true)
    const { post } = await signedInInstance({
      plugins: [await stripePlugin(authorizeReference)],
      databaseTables: ['subscription', 'organization']
    })
    const response = await post('/subscription/upgrade', { plan: 'pro-monthly', referenceId: 'org-1', seats: 50 }, false)
    expect(response.status).toBe(401)
    expect(authorizeReference).not.toHaveBeenCalled()
    expect(findOrganization).not.toHaveBeenCalled()
  })
})
