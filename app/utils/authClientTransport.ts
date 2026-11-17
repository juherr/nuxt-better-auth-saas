/** Fetch that dispatches a relative path inside the server process (Nitro's `event.fetch`). */
export type LocalFetch = (path: string, init?: RequestInit) => Promise<Response>

export interface AuthClientTransportInput {
  isServer: boolean
  origin: string
  requestHeaders?: Record<string, string | undefined>
  localFetch?: LocalFetch
}

export interface AuthClientTransport {
  baseURL: string
  fetchOptions: {
    headers?: Record<string, string>
    customFetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  }
}

/**
 * Transport of the better-auth client. In the browser it keeps the page origin and the default
 * fetch. During SSR the origin comes from the inbound `Host` header, so the client never calls
 * it: every request is cut down to its path and query and dispatched in-process, and only the
 * visitor's cookie is handed over.
 */
export function authClientTransport(input: AuthClientTransportInput): AuthClientTransport {
  if (!input.isServer)
    return { baseURL: input.origin, fetchOptions: { headers: undefined } }

  const cookie = input.requestHeaders?.cookie
  const { localFetch } = input
  return {
    baseURL: input.origin,
    fetchOptions: {
      headers: cookie ? { cookie } : {},
      customFetchImpl: async (request, init) => {
        if (!localFetch)
          throw new Error('The auth client has no in-process fetch on the server')
        const url = new URL(request instanceof Request ? request.url : request)
        return localFetch(`${url.pathname}${url.search}`, {
          method: init?.method,
          // h3 spreads these headers into a plain object: a Headers instance would be lost.
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: init?.body
        })
      }
    }
  }
}
