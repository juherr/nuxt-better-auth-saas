import { ssrCookieHeaders } from '~/utils/ssrCookies'

/**
 * Cookie header for a `$fetch` to the app's own API, in place of `useRequestHeaders(['cookie'])`:
 * during SSR it carries the cookies set by earlier in-process calls of the render (e.g.
 * `setActive`); in the browser it returns no header, as `useRequestHeaders` does. Call it where
 * `useRequestHeaders` could be called (inside the Nuxt context).
 */
export function useSsrCookieHeaders(): Record<string, string> {
  if (import.meta.client)
    return {}
  return ssrCookieHeaders(useRequestEvent())
}
