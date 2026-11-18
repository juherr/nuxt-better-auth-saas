import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

const db = vi.hoisted(() => {
  const where = vi.fn(async () => [])
  return { where, delete: vi.fn(() => ({ where })) }
})
const settledUpgrade = { context: { body: { plan: 'pro', customerType: 'organization', referenceId: 'org-1', seats: 3 } } }
const checkoutSeatsOverride = vi.hoisted(() => vi.fn())

vi.mock('better-auth', async importOriginal => ({
  ...await importOriginal<typeof import('better-auth')>(),
  // Hand back the options instead of building an auth instance.
  betterAuth: (options: unknown) => options
}))
vi.mock('~~/server/utils/runtimeConfig', () => ({
  runtimeConfig: { public: { baseURL: 'https://saas.example.test' } }
}))
vi.mock('~~/server/utils/db', () => ({ getDB: () => db }))
const resend = vi.hoisted(() => ({ emails: { send: vi.fn() } }))
const getResendClient = vi.hoisted(() => vi.fn((): unknown => undefined))
const renderTeamInvite = vi.hoisted(() => vi.fn(async () => '<html></html>'))
vi.mock('~~/server/utils/drivers', () => ({ cacheClient: {}, getResendClient }))
vi.mock('~~/server/utils/email', () => ({
  renderDeleteAccount: vi.fn(),
  renderResetPassword: vi.fn(),
  renderTeamInvite,
  renderVerifyEmail: vi.fn()
}))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))
vi.mock('~~/server/utils/emails', () => ({}))
vi.mock('~~/server/utils/stripe', () => ({
  checkoutSeatsOverride,
  createStripeClient: vi.fn(),
  isStripeConfigured: () => false,
  resolveUpgradeReferenceId: () => 'org-1',
  setupStripe: vi.fn()
}))
// The before hook resolves the session itself: read it from the context.
vi.mock('better-auth/api', async importOriginal => ({
  ...await importOriginal<typeof import('better-auth/api')>(),
  getSessionFromCtx: vi.fn(async (ctx: any) => ctx.context?.session ?? null)
}))

const { createBetterAuth } = await import('~~/server/utils/auth')
const options = createBetterAuth() as any

// authStorage.test.ts covers the values of authStorageOptions; these check
// that createBetterAuth passes them on, since hub:kv cannot consume or count
// atomically.
describe('the better-auth storage options', () => {
  it('stores verification values in the database', () => {
    expect(options.verification?.storeInDatabase).toBe(true)
  })

  it('stores rate-limit counters in the database', () => {
    expect(options.rateLimit?.storage).toBe('database')
  })
})

describe('the before hook', () => {
  it('hands an upgrade the body the checkout seats override settles', async () => {
    checkoutSeatsOverride.mockResolvedValue(settledUpgrade)
    const session = { user: { id: 'user-1' }, session: { id: 'session-1' } }

    const result = await options.hooks.before({ path: '/subscription/upgrade', body: { plan: 'pro' }, context: { session } })

    expect(result).toEqual(settledUpgrade)
    expect(checkoutSeatsOverride).toHaveBeenCalledWith(expect.objectContaining({ body: { plan: 'pro' } }), session)
  })
})

describe('the invitation email', () => {
  it('links to the accept-invite page', async () => {
    getResendClient.mockReturnValueOnce(resend)
    const organizationPlugin = options.plugins.find((plugin: any) => plugin.id === 'organization')

    await organizationPlugin.options.sendInvitationEmail({
      email: 'invitee@example.test',
      inviter: { user: { name: 'Ada', email: 'ada@example.test' } },
      organization: { name: 'Acme' },
      invitation: { id: 'inv-1' }
    })

    expect(renderTeamInvite).toHaveBeenCalledWith('Ada', 'Acme', 'https://saas.example.test/accept-invite/inv-1')
    expect(resend.emails.send).toHaveBeenCalledTimes(1)
  })
})

describe('the organization create hook', () => {
  const organization = { name: 'Acme', slug: 'acme' }
  const organizationHooks = () => options.plugins.find((plugin: any) => plugin.id === 'organization').options.organizationHooks

  // A database hook cannot see the creator; the plugin hook receives it.
  it('runs in the organization plugin, not as database hooks', () => {
    expect(organizationHooks().beforeCreateOrganization).toBeTypeOf('function')
    expect(Object.keys(options.databaseHooks).sort()).toEqual(['session', 'user'])
  })

  it('copies the creator\'s referral code onto the organization', async () => {
    const user = { id: 'user-1', email: 'ada@example.test', referralCode: 'REF-42' }

    const result = await organizationHooks().beforeCreateOrganization({ organization, user })

    expect(result).toEqual({ data: { ...organization, referralCode: 'REF-42' } })
  })

  it('leaves the organization unchanged for a creator without a referral code', async () => {
    const user = { id: 'user-1', email: 'ada@example.test', referralCode: null }

    const result = await organizationHooks().beforeCreateOrganization({ organization, user })

    expect(result).toBeUndefined()
  })
})

describe('the user create hook', () => {
  // better-auth passes a null context when a user is created outside an
  // endpoint (internalAdapter calls, the admin seed).
  it('leaves the user unchanged when there is no endpoint context', async () => {
    const result = await options.databaseHooks.user.create.before({ id: 'user-1', email: 'a@example.test' }, null)

    expect(result).toBeUndefined()
  })
})

describe('the user delete hook', () => {
  beforeEach(() => {
    db.delete.mockClear()
    db.where.mockClear()
  })

  // api_key.reference_id has no foreign key to user since better-auth 1.5,
  // so nothing in the database removes the keys of a deleted user.
  it('deletes the API keys the deleted user owns', async () => {
    const result = await options.databaseHooks.user.delete?.before?.({ id: 'user-1' })

    expect(db.delete).toHaveBeenCalledWith(schema.apiKey)
    expect(db.where).toHaveBeenCalledTimes(1)
    const [[where]] = db.where.mock.calls as unknown as [[SQL]]
    const condition = new PgDialect().sqlToQuery(where)
    expect(condition).toMatchObject({ sql: '"api_key"."reference_id" = $1', params: ['user-1'] })
    // better-auth cancels the deletion when a before hook returns false.
    expect(result).not.toBe(false)
  })

  // Delete paths run outside a transaction: a failing after hook would leave
  // the user deleted with its cached sessions alive, a failing before hook
  // aborts the deletion with nothing modified.
  it('cleans up before the user row is deleted, not after', () => {
    expect(options.databaseHooks.user.delete?.after).toBeUndefined()
  })
})
