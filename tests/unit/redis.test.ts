import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createRedisStore } from '~~/server/services/file/rateLimitStores'
import { createRedisClient, resolveRedisUrl } from '~~/server/utils/redis'

describe('the Redis URL used by the rate limiter', () => {
  it.each([
    [{ REDIS_URL: 'redis://a:6379', KV_URL: 'rediss://b:6380' }, 'redis://a:6379'],
    [{ KV_URL: 'rediss://b:6380' }, 'rediss://b:6380'],
    [{ KV_URL: 'redis://b:6379' }, null],
    [{ UPSTASH_REDIS_REST_URL: 'https://c', UPSTASH_REDIS_REST_TOKEN: 't' }, null],
    [{}, null]
  ])('mirrors the NuxtHub KV selection for %o', (env, expected) => {
    expect(resolveRedisUrl(env)).toBe(expected)
  })
})

describe('the production Redis client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses an upload within seconds when Redis is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Nothing listens on port 1: every connection attempt is refused.
    const client = await createRedisClient('redis://127.0.0.1:1')
    try {
      const limiter = new UploadRateLimiter(10, 5, createRedisStore(client))
      const startedAt = Date.now()

      const result = await limiter.checkAndIncrement('user-redis-unreachable')

      expect(result).toEqual({ allowed: false, currentCount: 0 })
      expect(Date.now() - startedAt).toBeLessThan(5000)
    } finally {
      client.disconnect()
    }
  }, 10_000)
})
