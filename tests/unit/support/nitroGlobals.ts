import { vi } from 'vitest'

export interface HttpErrorInput {
  statusCode: number
  statusMessage: string
}

/**
 * Nitro auto-imports these h3 helpers in server code; unit tests run in plain
 * Node, so stand in with the same shapes. `defineEventHandler` and
 * `defineNitroPlugin` return their argument. `readBody` returns `event.body`,
 * `getQuery` returns `event.query` and `getRouterParam` reads `event.params`.
 * `getRequestHeader` reads `event.headers`, `setResponseHeader` writes
 * `event.responseHeaders` and `getResponseStatus` reads `event.node.res.statusCode`.
 */
export function stubNitroGlobals() {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('defineNitroPlugin', (plugin: unknown) => plugin)
  vi.stubGlobal('readBody', async (event: { body?: unknown }) => event?.body)
  vi.stubGlobal('getQuery', (event: { query?: unknown }) => event?.query ?? {})
  vi.stubGlobal('getRouterParam', (event: { params?: Record<string, string> }, name: string) => event?.params?.[name])
  vi.stubGlobal('getRequestHeader', (event: { headers?: Record<string, string> }, name: string) =>
    event?.headers?.[name.toLowerCase()])
  vi.stubGlobal('setResponseHeader', (event: { responseHeaders?: Record<string, string> }, name: string, value: string) => {
    event.responseHeaders = { ...event.responseHeaders, [name.toLowerCase()]: value }
  })
  vi.stubGlobal('getResponseStatus', (event: { node?: { res?: { statusCode?: number } } }) =>
    event?.node?.res?.statusCode ?? 200)
  vi.stubGlobal('createError', (input: HttpErrorInput) =>
    Object.assign(new Error(input.statusMessage), input))
}

/** Calls a route module's default handler with an event carrying `body`, `query` and `params`. */
export async function callRoute<T = unknown>(
  load: () => Promise<{ default: unknown }>,
  body: unknown,
  query?: Record<string, unknown>,
  params?: Record<string, string>
): Promise<T> {
  const { default: handler } = await load()
  return (handler as (event: unknown) => Promise<T>)({ body, query, params })
}
