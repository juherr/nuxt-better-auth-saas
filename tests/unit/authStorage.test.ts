import { getAuthTables } from 'better-auth/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig: {} }))

const { authStorageOptions } = await import('~~/server/utils/authStorage')

// hub:kv cannot consume or count atomically, so better-auth must keep
// single-use verification values and rate-limit counters out of the
// secondary storage (internal-adapter.mjs consumeVerificationValue,
// api/rate-limiter getRateLimitStorage, oauth2/dpop.mjs).
describe('authStorageOptions', () => {
  it('keeps sessions in the secondary storage', () => {
    expect(authStorageOptions.secondaryStorage).toBeDefined()
  })

  it('stores verification values in the database', () => {
    expect(authStorageOptions.verification.storeInDatabase).toBe(true)
  })

  it('stores rate-limit counters in the database', () => {
    expect(authStorageOptions.rateLimit.storage).toBe('database')
  })

  it('makes the auth schema include the rateLimit table', () => {
    expect(getAuthTables(authStorageOptions)).toHaveProperty('rateLimit')
  })
})
