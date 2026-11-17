import { createAuthClient } from 'better-auth/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authClientTransport } from '~~/app/utils/authClientTransport'

const HOSTILE_ORIGIN = 'http://canary-host.invalid:8443'

const inboundHeaders = {
  'host': 'canary-host.invalid:8443',
  'cookie': 'better-auth.session_token=canary-session',
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

    it('hands only the inbound cookie to the local fetch', async () => {
      const { localFetch, client } = serverClient()

      await client.$fetch('/get-session')

      const headers = localFetch.mock.calls[0]![1]?.headers as Record<string, string>
      expect(headers.cookie).toBe(inboundHeaders.cookie)
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
