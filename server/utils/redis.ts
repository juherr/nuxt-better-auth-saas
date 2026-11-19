// SPDX-License-Identifier: MIT
import type { Redis } from 'ioredis'
import type { EventEmitter } from 'node:events'

type Env = Record<string, string | undefined>

/**
 * Redis URL NuxtHub would pick for its KV driver, with the same Redis URL
 * selection as `resolveKVConfig` in `@nuxthub/core` 0.10
 * (`dist/module.mjs`): `REDIS_URL`, else a `KV_URL` that starts with
 * `rediss://`. Unlike NuxtHub, it ignores an explicit `hub.kv` driver and
 * the Upstash REST variables, which NuxtHub checks first.
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

/**
 * Logs the first error of an outage, then stays quiet until the client is
 * `ready` again and logs the recovery once. ioredis emits an error on every
 * reconnection attempt, which would otherwise flood the log.
 */
export const logRedisConnectionState = (client: Pick<EventEmitter, 'on'>): void => {
  let failing = false
  client.on('error', (error: Error) => {
    if (!failing) {
      failing = true
      console.error('Redis client error:', error.message)
    }
  })
  client.on('ready', () => {
    if (failing) {
      failing = false
      console.info('Redis client recovered')
    }
  })
}

/**
 * Redis client with the application's timeouts and error listener.
 * ioredis is only loaded here, when a URL is actually used.
 */
export const createRedisClient = async (url: string): Promise<Redis> => {
  const { Redis } = await import('ioredis')
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: COMMAND_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS
  })
  logRedisConnectionState(client)
  return client
}

let redisClient: Promise<Redis | null> | undefined

/**
 * Shared Redis client built from the run environment, or null when no
 * Redis URL is set.
 */
export const getRedisClient = (): Promise<Redis | null> => {
  redisClient ??= (async () => {
    const url = resolveRedisUrl(process.env)
    return url ? createRedisClient(url) : null
  })()
  return redisClient
}

/** Test-only: closes the shared client and lets the next call build a new one. */
export const resetRedisClient = async (): Promise<void> => {
  const client = await redisClient
  redisClient = undefined
  await client?.quit()
}
