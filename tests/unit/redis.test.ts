import { describe, expect, it } from 'vitest'
import { resolveRedisUrl } from '~~/server/utils/redis'

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
