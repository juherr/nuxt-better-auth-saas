// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

// The unit project resolves `~~` only: map useAuth's `~/utils` import.
vi.mock('~/utils/authClientTransport', () => import('~~/app/utils/authClientTransport'))
vi.mock('~/utils/ssrCookies', () => import('~~/app/utils/ssrCookies'))

// useAuth relies on Nuxt auto-imports: stand them in as globals.
beforeEach(() => {
  vi.stubGlobal('useRequestURL', () => new URL('http://localhost:3000/forgot-password'))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { payment: 'stripe' } }))
  vi.stubGlobal('useState', (_key: string, init: () => unknown) => ref(init()))
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAuth password reset', () => {
  it('requests a reset through the endpoint the server serves', async () => {
    const fetch = vi.fn(async (_url: string | URL, _init: RequestInit & { body: string }) => new Response('{"status":true}', { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const { useAuth } = await import('~~/app/composables/useAuth')

    const { error } = await useAuth().requestPasswordReset({ email: 'a@example.com', redirectTo: '/reset-password' })

    expect(error).toBeNull()
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toBe('http://localhost:3000/api/auth/request-password-reset')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(init.body)).toEqual({ email: 'a@example.com', redirectTo: '/reset-password' })
  })
})
