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
 */
export function authClientTransport(input: AuthClientTransportInput): AuthClientTransport {
  if (!input.isServer)
    return { baseURL: input.origin, fetchOptions: { headers: undefined } }

  const { localFetch, cookies } = input
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
