// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from 'vitest'

// better-auth 1.7 types getAndDelete and increment as required on
// SecondaryStorage (@better-auth/core dist/db/type.d.mts). hub:kv cannot
// run them atomically on every driver, so cacheClient refuses them and the
// auth config routes their callers to the database (authStorage.ts).

const store = vi.hoisted(() => {
  const entries = new Map<string, unknown>()
  return {
    entries,
    kv: {
      get: vi.fn(async (key: string) => entries.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, _options?: { ttl?: number }) => {
        entries.set(key, value)
      }),
      del: vi.fn(async (key: string) => {
        entries.delete(key)
      })
    }
  }
})

vi.mock('hub:kv', () => ({ kv: store.kv }))
vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig: {} }))

const { cacheClient } = await import('~~/server/utils/drivers')

beforeEach(() => {
  store.entries.clear()
  vi.clearAllMocks()
})

describe('cacheClient.getAndDelete', () => {
  it('refuses a non-atomic consume and leaves the value in place', async () => {
    await cacheClient.set('verification:abc', '{"id":"1"}', 60)

    await expect(cacheClient.getAndDelete('verification:abc')).rejects.toThrow(/not supported/)
    expect(await cacheClient.get('verification:abc')).toBe('{"id":"1"}')
    expect(store.kv.del).not.toHaveBeenCalled()
  })
})

describe('cacheClient.increment', () => {
  it('refuses a non-atomic counter and writes nothing', async () => {
    await expect(cacheClient.increment('rate:ip', 60)).rejects.toThrow(/not supported/)
    expect(store.kv.set).not.toHaveBeenCalled()
  })
})
