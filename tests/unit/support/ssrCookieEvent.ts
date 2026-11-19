// SPDX-License-Identifier: MIT
import type { SsrCookieEvent } from '~~/app/utils/ssrCookies'

/** A minimal h3 event for the SSR cookie jar, with a reader of the Set-Cookie sent to the browser. */
export function fakeEvent(cookie?: string) {
  const responseHeaders: Record<string, string | string[] | number | undefined> = {}
  const event: SsrCookieEvent = {
    node: {
      req: { headers: cookie === undefined ? {} : { cookie } },
      res: {
        getHeader: name => responseHeaders[name.toLowerCase()],
        setHeader: (name, value) => {
          responseHeaders[name.toLowerCase()] = value
        }
      }
    }
  }
  const setCookies = () => {
    const value = responseHeaders['set-cookie']
    return value === undefined ? [] : ([] as unknown[]).concat(value)
  }
  return { event, setCookies }
}

/** A response carrying one `Set-Cookie` header per argument. */
export function responseWith(...setCookies: string[]) {
  const headers = new Headers()
  for (const value of setCookies)
    headers.append('set-cookie', value)
  return new Response(null, { status: 200, headers })
}
