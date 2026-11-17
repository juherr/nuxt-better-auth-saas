import type { Redis } from 'ioredis'

type Env = Record<string, string | undefined>

/**
 * Redis URL NuxtHub picks for its KV driver, with the same precedence as
 * `resolveKVConfig` in `@nuxthub/core` 0.10 (`dist/module.mjs`): `REDIS_URL`,
 * else a `KV_URL` that starts with `rediss://`. Upstash REST variables are
 * not a Redis URL and are ignored here.
 */
export const resolveRedisUrl = (env: Env): string | null => {
  if (env.REDIS_URL) {
    return env.REDIS_URL
  }
  if (env.KV_URL?.startsWith('rediss://')) {
    return env.KV_URL
  }
  return null
}

// Bounds every command, queued ones included (ioredis arms the timeout
// before queuing), so a Redis outage fails a request within seconds
// instead of hanging it.
const COMMAND_TIMEOUT_MS = 2000

let redisClient: Promise<Redis | null> | undefined

/**
 * Shared Redis client built from the run environment, or null when no
 * Redis URL is set. ioredis is only loaded when a URL is present.
 */
export const getRedisClient = (): Promise<Redis | null> => {
  redisClient ??= (async () => {
    const url = resolveRedisUrl(process.env)
    if (!url) {
      return null
    }
    const { Redis } = await import('ioredis')
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: COMMAND_TIMEOUT_MS,
      commandTimeout: COMMAND_TIMEOUT_MS
    })
    client.on('error', (error) => {
      console.error('Redis client error:', error.message)
    })
    return client
  })()
  return redisClient
}
