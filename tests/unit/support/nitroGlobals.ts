import { vi } from 'vitest'

export interface HttpErrorInput {
  statusCode: number
  statusMessage: string
}

/**
 * Nitro auto-imports these h3 helpers in server code; unit tests run in plain
 * Node, so stand in with the same shapes. `readBody` returns `event.body`,
 * `getQuery` returns `event.query` and `getRouterParam` reads `event.params`.
 */
export function stubNitroGlobals() {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', async (event: { body?: unknown }) => event?.body)
  vi.stubGlobal('getQuery', (event: { query?: unknown }) => event?.query ?? {})
  vi.stubGlobal('getRouterParam', (event: { params?: Record<string, string> }, name: string) => event?.params?.[name])
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
