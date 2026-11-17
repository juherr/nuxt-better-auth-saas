import type { RateLimitResult, RateLimitStore } from './rateLimiter'
import { cacheClient } from '~~/server/utils/drivers'
import { getRedisClient } from '~~/server/utils/redis'

/**
 * Serialises async sections per key within one process: each call waits
 * for the previous one on the same key, whatever its outcome.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<void>>()

  get size() {
    return this.tails.size
  }

  async run<T>(key: string, section: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.tails.set(key, tail)

    await previous
    try {
      return await section()
    } finally {
      release()
      if (this.tails.get(key) === tail) {
        this.tails.delete(key)
      }
    }
  }
}

export interface KvLike {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, ttlSeconds: number) => Promise<void>
}

/**
 * Store over a plain key-value backend (`hub:kv`), made atomic by a
 * per-key lock. Correct on a single instance only: two processes, or an
 * eventually consistent backend such as Cloudflare KV, can still race.
 */
export const createLockedKvStore = (kv: KvLike, lock = new KeyedLock()): RateLimitStore => {
  const read = async (key: string) => {
    const raw = await kv.get(key)
    if (raw == null) {
      return 0
    }
    const count = Number(raw)
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid rate limit counter at ${key}`)
    }
    return count
  }

  return {
    read,
    reserve: (key, amount, max, ttlMs) => lock.run(key, async (): Promise<RateLimitResult> => {
      const count = await read(key)
      if (count + amount > max) {
        return { allowed: false, currentCount: count }
      }
      // Every write carries the time left in the bucket: a write without
      // a TTL would drop the expiry on TTL-capable drivers (Redis), and a
      // full-window TTL would extend it. unstorage TTLs are in seconds;
      // the Cloudflare KV driver raises them to its 60 s minimum itself
      // (unstorage/drivers/cloudflare-kv-binding.mjs:39), which is harmless
      // because the bucket is part of the key.
      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000))
      await kv.set(key, String(count + amount), ttlSeconds)
      return { allowed: true, currentCount: count + amount }
    })
  }
}

// KEYS[1] counter; ARGV amount, max, ttl in ms. Sets the expiry only when
// the key has none (first hit, or a key left without one), and rolls the
// increment back above the limit. Returns { allowed (0/1), count, pttl }.
export const RESERVE_SCRIPT = `
local count = redis.call('INCRBY', KEYS[1], ARGV[1])
if redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[3])
end
local pttl = redis.call('PTTL', KEYS[1])
if count > tonumber(ARGV[2]) then
  count = redis.call('DECRBY', KEYS[1], ARGV[1])
  return { 0, count, pttl }
end
return { 1, count, pttl }
`

export interface RedisLike {
  eval: (script: string, numKeys: number, ...args: (string | number)[]) => Promise<unknown>
  get: (key: string) => Promise<string | null>
}

/** Store over Redis: one Lua script per reservation, atomic across instances. */
export const createRedisStore = (redis: RedisLike): RateLimitStore => ({
  async reserve(key, amount, max, ttlMs) {
    // PEXPIRE 0 would delete the key: keep at least 1 ms.
    const ttl = Math.max(1, Math.ceil(ttlMs))
    const reply = await redis.eval(RESERVE_SCRIPT, 1, key, amount, max, ttl)
    if (!Array.isArray(reply) || typeof reply[0] !== 'number' || typeof reply[1] !== 'number') {
      throw new TypeError('Unexpected rate limit script reply')
    }
    return { allowed: reply[0] === 1, currentCount: reply[1] }
  },
  async read(key) {
    const raw = await redis.get(key)
    return raw == null ? 0 : Number(raw)
  }
})

let defaultStore: RateLimitStore | undefined

/**
 * Process-wide store: Redis when the run environment carries a Redis URL
 * (see `resolveRedisUrl`), otherwise `hub:kv` behind an in-process lock.
 * Shared by every limiter so the lock covers concurrent requests.
 */
export const defaultRateLimitStore = (): RateLimitStore => {
  defaultStore ??= (() => {
    const lockedKv = createLockedKvStore(cacheClient)
    const pick = async () => {
      const redis = await getRedisClient()
      return redis ? createRedisStore(redis) : lockedKv
    }
    return {
      reserve: async (...args) => (await pick()).reserve(...args),
      read: async key => (await pick()).read(key)
    }
  })()
  return defaultStore
}
