import { createAuthClient } from 'better-auth/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authClientTransport, configuredOrigin } from '~~/app/utils/authClientTransport'
import { ssrCookiePort } from '~~/app/utils/ssrCookies'
import { fakeEvent } from './support/ssrCookieEvent'

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

    describe('with a cookie port', () => {
      const SET_ACTIVE_COOKIE = 'better-auth.session_data=org-2; Path=/; HttpOnly'

      const portedClient = () => {
        let cookie = inboundHeaders.cookie
        const cookies = {
          header: vi.fn(() => cookie as string | undefined),
          capture: vi.fn((response: Response) => {
            const setCookie = response.headers.get('set-cookie')
            if (setCookie)
              cookie = setCookie.split(';')[0]!
          })
        }
        const localFetch = vi.fn(async (path: string, _init?: RequestInit) => path.endsWith('/set-active')
          ? new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'content-type': 'application/json', 'set-cookie': SET_ACTIVE_COOKIE }
            })
          : okResponse())
        const transport = authClientTransport({
          isServer: true,
          origin: HOSTILE_ORIGIN,
          requestHeaders: inboundHeaders,
          localFetch,
          cookies
        })
        return { localFetch, cookies, client: createAuthClient(transport), setCookie: (value: string | undefined) => {
          cookie = value as string
        } }
      }

      describe('backed by the SSR cookie jar', () => {
        const INBOUND_COOKIE = 'theme=dark; better-auth.session_data=org-1'

        const jarClient = (setActive: () => Response) => {
          const { event, setCookies } = fakeEvent(INBOUND_COOKIE)
          const localFetch = vi.fn(async (path: string, _init?: RequestInit) =>
            path.endsWith('/set-active') ? setActive() : okResponse())
          const client = createAuthClient(authClientTransport({
            isServer: true,
            origin: HOSTILE_ORIGIN,
            requestHeaders: { ...inboundHeaders, cookie: INBOUND_COOKIE },
            localFetch,
            cookies: ssrCookiePort(event)
          }))
          const cookieOf = (call: number) => (localFetch.mock.calls[call]![1]?.headers as Record<string, string>).cookie
          return { client, cookieOf, setCookies }
        }

        const switchToOrg2 = (client: ReturnType<typeof createAuthClient>) =>
          client.$fetch('/organization/set-active', { method: 'POST', body: { organizationId: 'org-2' } })

        it('sends the cookie set by set-active on the next call, unrelated inbound cookies kept', async () => {
          const { client, cookieOf, setCookies } = jarClient(() => new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'set-cookie': SET_ACTIVE_COOKIE }
          }))

          await switchToOrg2(client)
          await client.$fetch('/get-session')

          expect(cookieOf(1)).toBe('theme=dark; better-auth.session_data=org-2')
          expect(setCookies()).toEqual([SET_ACTIVE_COOKIE])
        })

        it('leaves the next cookie unchanged when set-active is refused without a Set-Cookie', async () => {
          const { client, cookieOf, setCookies } = jarClient(() => new Response(JSON.stringify({ message: 'Forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          }))

          await switchToOrg2(client)
          await client.$fetch('/get-session')

          expect(cookieOf(1)).toBe(INBOUND_COOKIE)
          expect(setCookies()).toEqual([])
        })
      })

      it('reads the cookie from the port on every call, not once at construction', async () => {
        const { localFetch, client, setCookie } = portedClient()

        await client.$fetch('/get-session')
        setCookie('better-auth.session_token=rotated')
        await client.$fetch('/get-session')

        expect((localFetch.mock.calls[0]![1]?.headers as Record<string, string>).cookie).toBe(inboundHeaders.cookie)
        expect((localFetch.mock.calls[1]![1]?.headers as Record<string, string>).cookie).toBe('better-auth.session_token=rotated')
      })

      // h3's `event.fetch` re-injects the inbound cookie unless the call carries a `cookie` key:
      // an empty one is what keeps a deleted cookie from coming back.
      it('sends an empty cookie key when every cookie was deleted', async () => {
        const { localFetch, client, setCookie } = portedClient()

        setCookie(undefined)
        await client.$fetch('/get-session')

        expect(localFetch.mock.calls[0]![1]?.headers).toHaveProperty('cookie', '')
      })

      it('still hands the inbound origin and referer over', async () => {
        const { localFetch, client } = portedClient()

        await client.$fetch('/organization/set-active', { method: 'POST', body: { organizationId: 'org-2' } })

        expect(localFetch.mock.calls[0]![1]?.headers).toMatchObject({
          origin: inboundHeaders.origin,
          referer: inboundHeaders.referer
        })
      })
    })

    // A typed URL or a bookmark carries neither Origin nor Referer, so better-auth refuses the
    // set-active of the organization middleware. Only that call gets the configured origin.
    describe('with a configured origin', () => {
      const CONFIGURED_ORIGIN = 'https://configured.example.test'

      const configuredClient = (requestHeaders: Record<string, string | undefined>) => {
        const localFetch = vi.fn(async (_path: string, _init?: RequestInit) => okResponse())
        const client = createAuthClient(authClientTransport({
          isServer: true,
          origin: HOSTILE_ORIGIN,
          configuredOrigin: CONFIGURED_ORIGIN,
          requestHeaders,
          localFetch
        }))
        const headersOf = (call: number) => localFetch.mock.calls[call]![1]?.headers as Record<string, string>
        return { client, headersOf }
      }

      // A typed URL or a bookmark: the browser says so with `Sec-Fetch-Site: none`.
      const withoutOriginOrReferer = { 'host': 'canary-host.invalid', 'cookie': inboundHeaders.cookie, 'sec-fetch-site': 'none' }

      const setActive = (client: ReturnType<typeof createAuthClient>) =>
        client.$fetch('/organization/set-active', { method: 'POST', body: { organizationId: 'org-2' } })

      it('sends the configured origin with a set-active that has neither Origin nor Referer', async () => {
        const { client, headersOf } = configuredClient(withoutOriginOrReferer)

        await setActive(client)

        expect(headersOf(0).origin).toBe(CONFIGURED_ORIGIN)
        expect(headersOf(0)).not.toHaveProperty('referer')
        expect(headersOf(0)).not.toHaveProperty('sec-fetch-site')
      })

      it('sends the configured origin when the navigation is same-origin', async () => {
        const { client, headersOf } = configuredClient({ ...withoutOriginOrReferer, 'sec-fetch-site': 'same-origin' })

        await setActive(client)

        expect(headersOf(0).origin).toBe(CONFIGURED_ORIGIN)
      })

      // A missing Referer is forgeable (`Referrer-Policy: no-referrer` on the linking page).
      it.each(['cross-site', 'same-site'])('sends no origin when the navigation is %s', async (site) => {
        const { client, headersOf } = configuredClient({ ...withoutOriginOrReferer, 'sec-fetch-site': site })

        await setActive(client)

        expect(headersOf(0)).not.toHaveProperty('origin')
      })

      it('sends no origin when the request has no Sec-Fetch-Site', async () => {
        const { 'sec-fetch-site': _, ...withoutFetchSite } = withoutOriginOrReferer
        const { client, headersOf } = configuredClient(withoutFetchSite)

        await setActive(client)

        expect(headersOf(0)).not.toHaveProperty('origin')
      })

      it('sends no origin with any other POST', async () => {
        const { client, headersOf } = configuredClient(withoutOriginOrReferer)

        await client.$fetch('/sign-out', { method: 'POST', body: {} })
        await client.$fetch('/organization/create', { method: 'POST', body: { name: 'Acme', slug: 'acme' } })

        expect(headersOf(0)).not.toHaveProperty('origin')
        expect(headersOf(1)).not.toHaveProperty('origin')
      })

      it('sends no origin with a GET to the set-active path', async () => {
        const { client, headersOf } = configuredClient(withoutOriginOrReferer)

        await client.$fetch('/organization/set-active', { method: 'GET' })

        expect(headersOf(0)).not.toHaveProperty('origin')
      })

      it('keeps an inbound Origin unchanged', async () => {
        const { client, headersOf } = configuredClient({ ...withoutOriginOrReferer, origin: 'https://evil.example' })

        await client.$fetch('/organization/set-active', { method: 'POST', body: { organizationId: 'org-2' } })

        expect(headersOf(0).origin).toBe('https://evil.example')
      })

      it('adds no origin when the request carries a Referer', async () => {
        const { client, headersOf } = configuredClient({ ...withoutOriginOrReferer, referer: 'https://evil.example/page' })

        await client.$fetch('/organization/set-active', { method: 'POST', body: { organizationId: 'org-2' } })

        expect(headersOf(0)).not.toHaveProperty('origin')
        expect(headersOf(0).referer).toBe('https://evil.example/page')
      })
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

  describe('configuredOrigin', () => {
    it('keeps only the origin of the configured app URL', () => {
      expect(configuredOrigin('https://app.example.test/base/')).toBe('https://app.example.test')
    })

    it('gives nothing for an empty or invalid app URL', () => {
      expect(configuredOrigin('')).toBeUndefined()
      expect(configuredOrigin(undefined)).toBeUndefined()
      expect(configuredOrigin('not a url')).toBeUndefined()
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
