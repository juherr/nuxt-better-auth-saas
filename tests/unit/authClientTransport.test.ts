import { createAuthClient } from 'better-auth/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authClientTransport } from '~~/app/utils/authClientTransport'

const HOSTILE_ORIGIN = 'http://canary-host.invalid:8443'

const inboundHeaders = {
  'host': 'canary-host.invalid:8443',
  'cookie': 'better-auth.session_token=canary-session',
  'origin': 'https://app.example.test',
  'referer': 'https://app.example.test/acme/dashboard',
  'authorization': 'Bearer canary-token',
  'x-forwarded-host': 'canary-forwarded.invalid',
  'x-forwarded-proto': 'https'
}

const okResponse = () => new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { 'content-type': 'application/json' }
})

describe('authClientTransport', () => {
  const networkFetch = vi.fn(async () => {
    throw new Error('the auth client must not reach the network during SSR')
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', networkFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    networkFetch.mockClear()
  })

  describe('on the server', () => {
    const serverClient = () => {
      const localFetch = vi.fn(async (_path: string, _init?: RequestInit) => okResponse())
      const transport = authClientTransport({
        isServer: true,
        origin: HOSTILE_ORIGIN,
        requestHeaders: inboundHeaders,
        localFetch
      })
      return { localFetch, client: createAuthClient(transport) }
    }

    it('sends a GET to the local fetch as a relative path, never to the network', async () => {
      const { localFetch, client } = serverClient()

      await client.$fetch('/organization/list', { query: { limit: 5 } })

      expect(networkFetch).not.toHaveBeenCalled()
      expect(localFetch).toHaveBeenCalledTimes(1)
      expect(localFetch.mock.calls[0]![0]).toBe('/api/auth/organization/list?limit=5')
    })

    it('sends a POST with its JSON body and content type as plain header keys', async () => {
      const { localFetch, client } = serverClient()

      await client.$fetch('/organization/set-active', {
        method: 'POST',
        body: { organizationId: 'org-1' }
      })

      expect(networkFetch).not.toHaveBeenCalled()
      const [path, init] = localFetch.mock.calls[0]!
      expect(path).toBe('/api/auth/organization/set-active')
      expect(init?.method).toBe('POST')
      expect(init?.body).toBe(JSON.stringify({ organizationId: 'org-1' }))
      expect(init?.headers).not.toBeInstanceOf(Headers)
      expect(init?.headers).toMatchObject({
        'content-type': 'application/json',
        'cookie': inboundHeaders.cookie
      })
    })

    // better-auth refuses a cookie-carrying POST whose Origin, or Referer when Origin is absent,
    // is missing or not a trusted origin (MISSING_OR_NULL_ORIGIN): the visitor's own values must
    // reach it so that it can still validate them.
    it('hands the inbound origin and referer to a POST so that better-auth can check them', async () => {
      const { localFetch, client } = serverClient()

      await client.$fetch('/organization/set-active', {
        method: 'POST',
        body: { organizationId: 'org-1' }
      })

      expect(localFetch.mock.calls[0]![1]?.headers).toMatchObject({
        origin: inboundHeaders.origin,
        referer: inboundHeaders.referer
      })
    })

    it('hands only the inbound cookie, origin and referer to the local fetch', async () => {
      const { localFetch, client } = serverClient()

      await client.$fetch('/get-session')

      const headers = localFetch.mock.calls[0]![1]?.headers as Record<string, string>
      expect(headers.cookie).toBe(inboundHeaders.cookie)
      expect(headers.origin).toBe(inboundHeaders.origin)
      expect(headers.referer).toBe(inboundHeaders.referer)
      expect(headers).not.toHaveProperty('authorization')
      expect(headers).not.toHaveProperty('host')
      expect(headers).not.toHaveProperty('x-forwarded-host')
      expect(headers).not.toHaveProperty('x-forwarded-proto')
    })

    it('omits the cookie header when the request has none', () => {
      const transport = authClientTransport({
        isServer: true,
        origin: HOSTILE_ORIGIN,
        requestHeaders: { host: 'canary-host.invalid' },
        localFetch: vi.fn()
      })

      expect(transport.fetchOptions.headers).toEqual({})
    })

    it('never derives an origin or referer from the Host when the request carries none', () => {
      const transport = authClientTransport({
        isServer: true,
        origin: HOSTILE_ORIGIN,
        requestHeaders: { 'host': 'canary-host.invalid', 'x-forwarded-host': 'canary-forwarded.invalid', 'cookie': inboundHeaders.cookie },
        localFetch: vi.fn()
      })

      expect(transport.fetchOptions.headers).toEqual({ cookie: inboundHeaders.cookie })
    })

    it('fails instead of reaching the network when no local fetch is available', async () => {
      const client = createAuthClient(authClientTransport({
        isServer: true,
        origin: HOSTILE_ORIGIN,
        requestHeaders: inboundHeaders
      }))

      await expect(client.$fetch('/get-session')).rejects.toThrow(/in-process/)
      expect(networkFetch).not.toHaveBeenCalled()
    })
  })

  describe('in the browser', () => {
    it('keeps the page origin, no forwarded headers and the default fetch', () => {
      const transport = authClientTransport({
        isServer: false,
        origin: 'https://app.example.test'
      })

      expect(transport).toEqual({
        baseURL: 'https://app.example.test',
        fetchOptions: { headers: undefined }
      })
    })
  })
})
