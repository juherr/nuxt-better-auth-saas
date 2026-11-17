/** Fetch that dispatches a relative path inside the server process (Nitro's `event.fetch`). */
export type LocalFetch = (path: string, init?: RequestInit) => Promise<Response>

/**
 * Cookies of the SSR render: `header()` gives the cookie to send now (inbound cookie updated by
 * the earlier calls of the render), `capture()` takes the `Set-Cookie` of each response.
 */
export interface TransportCookies {
  header: () => string | undefined
  capture: (response: Response) => void
}

export interface AuthClientTransportInput {
  isServer: boolean
  origin: string
  /** Origin of the configured app URL, the one better-auth trusts; never derived from `Host`. */
  configuredOrigin?: string
  requestHeaders?: Record<string, string | undefined>
  localFetch?: LocalFetch
  cookies?: TransportCookies
}

export interface AuthClientTransport {
  baseURL: string
  fetchOptions: {
    headers?: Record<string, string>
    customFetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  }
}

/**
 * Inbound headers handed to in-process auth calls: the session cookie, and the visitor's own
 * `origin` and `referer`, which better-auth's origin check reads (Origin first, then Referer) on
 * every cookie-carrying POST and validates against its trusted origins. They are never derived
 * from `Host` or `X-Forwarded-*`: a request without them stays refused.
 */
export const FORWARDED_REQUEST_HEADERS = ['cookie', 'origin', 'referer'] as const

/**
 * Inbound headers read during SSR but never handed over: `sec-fetch-site` tells a typed URL or
 * a bookmark (`none`) or a same-origin navigation from a cross-site one.
 */
export const SSR_REQUEST_HEADERS = [...FORWARDED_REQUEST_HEADERS, 'sec-fetch-site'] as const

/** `Sec-Fetch-Site` values of a navigation that no other site started. */
const OWN_FETCH_SITES = new Set(['none', 'same-origin'])

/** Path of the only call that may carry the configured origin (see `authClientTransport`). */
export const SET_ACTIVE_PATH = '/api/auth/organization/set-active'

/**
 * Origin of the app URL (`runtimeConfig.public.baseURL`), which the server gives better-auth as
 * its base URL and trusted origin. Undefined when the URL is empty or invalid.
 */
export function configuredOrigin(baseURL: string | undefined): string | undefined {
  if (!baseURL || !URL.canParse(baseURL))
    return undefined
  return new URL(baseURL).origin
}

function forwardedHeaders(requestHeaders: Record<string, string | undefined> | undefined) {
  const headers: Record<string, string> = {}
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = requestHeaders?.[name]
    if (value)
      headers[name] = value
  }
  return headers
}

/**
 * Transport of the better-auth client. In the browser it keeps the page origin and the default
 * fetch. During SSR the origin comes from the inbound `Host` header, so the client never calls
 * it: every request is cut down to its path and query and dispatched in-process, and only the
 * headers in `FORWARDED_REQUEST_HEADERS` are handed over.
 *
 * A request without Origin and Referer (typed URL, bookmark) would get the set-active of the
 * organization middleware refused by better-auth's origin check: that POST alone gets the
 * configured origin, and only when `Sec-Fetch-Site` is `none` or `same-origin`: a missing
 * Referer is forgeable (`Referrer-Policy: no-referrer` on a linking page), a cross-site
 * navigation or one without that header stays refused. Every other call keeps the visitor's
 * headers, so an inbound Origin or Referer is still checked, and a cross-site one still refused.
 */
export function authClientTransport(input: AuthClientTransportInput): AuthClientTransport {
  if (!input.isServer)
    return { baseURL: input.origin, fetchOptions: { headers: undefined } }

  const { localFetch, cookies } = input
  const injectOrigin = !!input.configuredOrigin
    && !input.requestHeaders?.origin
    && !input.requestHeaders?.referer
    && OWN_FETCH_SITES.has(input.requestHeaders?.['sec-fetch-site'] ?? '')
  return {
    baseURL: input.origin,
    fetchOptions: {
      headers: forwardedHeaders(input.requestHeaders),
      customFetchImpl: async (request, init) => {
        if (!localFetch)
          throw new Error('The auth client has no in-process fetch on the server')
        const url = new URL(request instanceof Request ? request.url : request)
        // h3 spreads these headers into a plain object: a Headers instance would be lost.
        const headers = Object.fromEntries(new Headers(init?.headers))
        // The cookie fixed at construction is stale once a call of the render set a new one.
        // h3 re-injects the inbound cookie unless a lowercase `cookie` key is present, so an
        // empty value is sent when every cookie was deleted.
        if (cookies)
          headers.cookie = cookies.header() ?? ''
        if (injectOrigin && init?.method?.toUpperCase() === 'POST' && url.pathname === SET_ACTIVE_PATH)
          headers.origin = input.configuredOrigin!
        const response = await localFetch(`${url.pathname}${url.search}`, {
          method: init?.method,
          headers,
          body: init?.body
        })
        cookies?.capture(response)
        return response
      }
    }
  }
}
