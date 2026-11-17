import type { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createRedisStore } from '~~/server/services/file/rateLimitStores'
import { createRedisClient, resetRedisClient } from '~~/server/utils/redis'

// Runs against a real Redis given by REDIS_URL. CI provides one: there the
// suite fails instead of skipping when the variable is missing.
const redisUrl = process.env.REDIS_URL
const inCi = !!process.env.CI

const WINDOW_MINUTES = 10
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000

describe.skipIf(!redisUrl && !inCi)('the upload rate limiter against Redis', () => {
  // The client the application builds, with its timeouts and listeners.
  let redis: Redis | null = null
  const prefix = `rl-test-${randomUUID()}`

  beforeAll(async () => {
    redis = redisUrl ? await createRedisClient(redisUrl) : null
  })

  afterAll(async () => {
    // Every test key embeds the prefix: drop them all, whatever passed.
    const keys = await redis?.keys(`upload_rate_limit:${prefix}-*`) ?? []
    if (keys.length > 0) {
      await redis!.del(...keys)
    }
    await redis?.quit()
    await resetRedisClient()
  })

  const connected = () => {
    expect(redisUrl, 'REDIS_URL must be set when CI is set').toBeTruthy()
    return redis!
  }

  it('accepts exactly max out of 50 concurrent requests', async () => {
    const client = connected()
    const store = createRedisStore(client)

    const results = await Promise.all(
      Array.from({ length: 50 }, () => new UploadRateLimiter(WINDOW_MINUTES, 5, store).checkAndIncrement(`${prefix}-concurrent`))
    )

    expect(results.filter(r => r.allowed)).toHaveLength(5)
    expect(results.filter(r => !r.allowed).every(r => r.currentCount === 5)).toBe(true)
  })

  it('sets the expiry once, to the time left in the bucket', async () => {
    const client = connected()
    const store = createRedisStore(client)
    const userId = `${prefix}-ttl`
    // Two minutes into a bucket that starts well after now.
    const bucketStart = (Math.floor(Date.now() / WINDOW_MS) + 1) * WINDOW_MS
    let now = bucketStart + 2 * 60 * 1000
    const limiter = new UploadRateLimiter(WINDOW_MINUTES, 5, store, () => now)
    const key = `upload_rate_limit:${userId}:${bucketStart / WINDOW_MS}`

    await limiter.checkAndIncrement(userId)
    const firstPttl = await client.pttl(key)
    now += 3 * 60 * 1000
    await limiter.checkAndIncrement(userId)
    const secondPttl = await client.pttl(key)

    expect(firstPttl).toBeGreaterThan(8 * 60 * 1000 - 5000)
    expect(firstPttl).toBeLessThanOrEqual(8 * 60 * 1000)
    // Not reset to the new remaining 5 minutes, nor to a full window.
    expect(secondPttl).toBeGreaterThan(8 * 60 * 1000 - 5000)
    expect(secondPttl).toBeLessThanOrEqual(firstPttl)
    expect(await client.get(key)).toBe('2')
    await client.del(key)
  })

  it('refuses a batch over the limit without consuming it', async () => {
    const client = connected()
    const store = createRedisStore(client)
    const userId = `${prefix}-batch`
    const limiter = new UploadRateLimiter(WINDOW_MINUTES, 5, store)

    await limiter.checkAndIncrement(userId, 3)

    expect(await limiter.checkAndIncrement(userId, 3)).toEqual({ allowed: false, currentCount: 3 })
    expect(await limiter.checkAndIncrement(userId, 2)).toEqual({ allowed: true, currentCount: 5 })
    expect(await limiter.getCurrentCount(userId)).toBe(5)
  })

  it('goes through Redis when the limiter is built without a store, as in the upload route', async () => {
    const client = connected()
    const userId = `${prefix}-default`

    const result = await new UploadRateLimiter(WINDOW_MINUTES, 5).checkAndIncrement(userId)

    expect(result).toEqual({ allowed: true, currentCount: 1 })
    const keys = await client.keys(`upload_rate_limit:${userId}:*`)
    expect(keys).toHaveLength(1)
    expect(await client.get(keys[0]!)).toBe('1')
    await client.del(...keys)
  })
})
