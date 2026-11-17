import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubNitroGlobals } from './support/nitroGlobals'

const runtimeConfig = vi.hoisted(() => ({ logLevel: '', logFormat: '' }))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))

beforeAll(stubNitroGlobals)
afterAll(() => {
  vi.unstubAllGlobals()
})

interface FakeEvent {
  method: string
  path: string
  headers: Record<string, string>
  responseHeaders?: Record<string, string>
  node?: { req: { headers: Record<string, string> }, res: EventEmitter & { statusCode: number } }
}

function fakeEvent(path: string, headers: Record<string, string> = {}): FakeEvent {
  const res = Object.assign(new EventEmitter(), { statusCode: 200 })
  return { method: 'GET', path, headers, node: { req: { headers: { ...headers } }, res } }
}

async function runMiddleware(event: FakeEvent) {
  const { default: middleware } = await import('~~/server/middleware/0.common')
  await (middleware as (event: unknown) => unknown)(event)
}

function finish(event: FakeEvent, status: number) {
  event.node!.res.statusCode = status
  event.node!.res.emit('finish')
}

describe('the access log middleware', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const loggedLine = () => String(log.mock.calls[0]?.[0])

  beforeEach(() => {
    runtimeConfig.logLevel = ''
    runtimeConfig.logFormat = ''
    log.mockClear()
    warn.mockClear()
    error.mockClear()
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('logs one line without the query once the response is sent', async () => {
    const event = fakeEvent('/reset-password?token=one-time-value#frag')

    await runMiddleware(event)
    expect(log).not.toHaveBeenCalled()
    finish(event, 200)

    expect(log).toHaveBeenCalledTimes(1)
    const line = loggedLine()
    expect(line).toContain('GET /reset-password 200')
    expect(line).not.toContain('one-time-value')
    expect(line).not.toContain('token')
  })

  it('echoes a valid inbound request id and logs it', async () => {
    const event = fakeEvent('/dashboard', { 'x-request-id': 'proxy-42' })

    await runMiddleware(event)
    finish(event, 200)

    expect(event.responseHeaders?.['x-request-id']).toBe('proxy-42')
    expect(loggedLine()).toContain('request_id=proxy-42')
  })

  it('replaces an unsafe inbound request id with a generated one', async () => {
    const event = fakeEvent('/dashboard', { 'x-request-id': 'bad id\r\nx: 1' })

    await runMiddleware(event)

    expect(event.responseHeaders?.['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('passes the resolved id on to the request headers, so internal sub-requests reuse it', async () => {
    const event = fakeEvent('/dashboard')

    await runMiddleware(event)

    expect(event.node!.req.headers['x-request-id']).toBe(event.responseHeaders?.['x-request-id'])
  })

  it('writes JSON lines when configured', async () => {
    runtimeConfig.logFormat = 'json'
    const event = fakeEvent('/callback?code=one-time-value&state=x')

    await runMiddleware(event)
    finish(event, 302)

    expect(JSON.parse(loggedLine())).toMatchObject({ method: 'GET', path: '/callback', status: 302 })
  })

  it('writes 4xx lines as warnings and 5xx lines as errors', async () => {
    const notFound = fakeEvent('/missing')
    const failed = fakeEvent('/broken')

    await runMiddleware(notFound)
    await runMiddleware(failed)
    finish(notFound, 404)
    finish(failed, 500)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it('drops lines below the configured level', async () => {
    runtimeConfig.logLevel = 'warn'
    const ok = fakeEvent('/dashboard')
    const notFound = fakeEvent('/missing')

    await runMiddleware(ok)
    await runMiddleware(notFound)
    finish(ok, 200)
    finish(notFound, 404)

    expect(log).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('sets the request id without throwing when the response is not an event emitter', async () => {
    const event = fakeEvent('/dashboard')
    delete event.node

    await expect(runMiddleware(event)).resolves.toBeUndefined()
    expect(event.responseHeaders?.['x-request-id']).toBeDefined()
  })
})
