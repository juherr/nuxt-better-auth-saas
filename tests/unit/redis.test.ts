// SPDX-License-Identifier: MIT
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RateLimitUnavailableError, UploadRateLimiter } from '~~/server/services/file/rateLimiter'
import { createRedisStore } from '~~/server/services/file/rateLimitStores'
import { createRedisClient, logRedisConnectionState, resolveRedisUrl } from '~~/server/utils/redis'

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

      await expect(limiter.checkAndIncrement('user-redis-unreachable')).rejects.toThrow(RateLimitUnavailableError)
      expect(Date.now() - startedAt).toBeLessThan(5000)
    } finally {
      client.disconnect()
    }
  }, 10_000)
})

describe('the Redis client error log', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs the first failure of an outage and its recovery, once each', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const client = new EventEmitter()
    logRedisConnectionState(client)

    client.emit('ready')
    client.emit('error', new Error('connect ECONNREFUSED'))
    client.emit('error', new Error('connect ECONNREFUSED'))
    client.emit('error', new Error('connect ECONNREFUSED'))

    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('Redis client error:', 'connect ECONNREFUSED')
    expect(info).not.toHaveBeenCalled()

    client.emit('ready')
    client.emit('ready')

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('Redis client recovered')

    client.emit('error', new Error('read ECONNRESET'))

    expect(error).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenLastCalledWith('Redis client error:', 'read ECONNRESET')
  })
})
