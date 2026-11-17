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
vi.mock('~~/server/utils/drivers', () => ({ cacheClient: {}, getResendClient: () => undefined }))
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
