// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('the upload rate limiter as the upload route builds it', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('shares one lock across limiters when no Redis URL is set', async () => {
    // CI sets REDIS_URL for the whole job: force the in-process path.
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('KV_URL', '')
    vi.resetModules()
    const { UploadRateLimiter } = await import('~~/server/services/file/rateLimiter')

    // A new limiter per request, without a store argument, as in the route.
    const results = await Promise.all(
      Array.from({ length: 50 }, () => new UploadRateLimiter(10, 5).checkAndIncrement('user-default-store'))
    )

    expect(results.filter(r => r.allowed)).toHaveLength(5)
  })
})
