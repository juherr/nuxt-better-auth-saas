import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubNitroGlobals } from './support/nitroGlobals'

const runtimeConfig = vi.hoisted(() => ({ logLevel: '', logFormat: '' }))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))

beforeAll(stubNitroGlobals)
afterAll(() => {
  vi.unstubAllGlobals()
})

type FakeResponse = EventEmitter & { statusCode: number, writableFinished: boolean, socket: null }

interface FakeEvent {
  method: string
  path: string
  headers: Record<string, string>
  context: Record<string, unknown>
  responseHeaders?: Record<string, string>
  node?: { req: { headers: Record<string, string> }, res: FakeResponse }
}

// Like node-mock-http's response on cloudflare-module: no socket, and nothing
// guarantees `finish` or `close`; each test emits what the runtime would.
function fakeEvent(path: string, headers: Record<string, string> = {}): FakeEvent {
  const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false, socket: null })
  return { method: 'GET', path, headers, context: {}, node: { req: { headers: { ...headers } }, res } }
}

async function runMiddleware(event: FakeEvent) {
  const { default: middleware } = await import('~~/server/middleware/0.common')
  await (middleware as (event: unknown) => unknown)(event)
}

type AfterResponseHook = (event: unknown) => unknown

/** Runs the access log plugin's `afterResponse` hook, as Nitro would. */
async function afterResponse(event: FakeEvent, status: number) {
  const { default: plugin } = await import('~~/server/plugins/accessLog')
  const hooks: Record<string, AfterResponseHook> = {}
  ;(plugin as (nitroApp: unknown) => void)({
    hooks: { hook: (name: string, hook: AfterResponseHook) => { hooks[name] = hook } }
  })
  event.node!.res.statusCode = status
  await hooks.afterResponse!(event)
}

/** A completed response on Node: `finish`, then `close`. */
function finish(event: FakeEvent, status: number) {
  const res = event.node!.res
  res.statusCode = status
  res.writableFinished = true
  res.emit('finish')
  res.emit('close')
}

/** A completed response on node-mock-http: `end()` emits `close` before `finish`. */
function finishCloseFirst(event: FakeEvent, status: number) {
  const res = event.node!.res
  res.statusCode = status
  res.writableFinished = true
  res.emit('close')
  res.emit('finish')
}

/** The client went away before the response completed: `close` only. */
function disconnect(event: FakeEvent) {
  event.node!.res.emit('close')
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

  it('logs one line for a streamed response without a socket, which never emits finish', async () => {
    const event = fakeEvent('/api/auth/get-session')

    await runMiddleware(event)
    await afterResponse(event, 200)

    expect(log).toHaveBeenCalledTimes(1)
    expect(loggedLine()).toContain('GET /api/auth/get-session 200')
  })

  it('logs once when the response hook, finish and close all fire', async () => {
    const event = fakeEvent('/dashboard')

    await runMiddleware(event)
    await afterResponse(event, 200)
    finish(event, 200)

    expect(log).toHaveBeenCalledTimes(1)
  })

  it('logs once when finish is followed by close', async () => {
    const event = fakeEvent('/dashboard')

    await runMiddleware(event)
    finish(event, 200)

    expect(log).toHaveBeenCalledTimes(1)
    expect(loggedLine()).toContain('GET /dashboard 200')
  })

  it('logs once with the real status when close comes before finish on a completed response', async () => {
    const event = fakeEvent('/dashboard')

    await runMiddleware(event)
    finishCloseFirst(event, 201)

    expect(log).toHaveBeenCalledTimes(1)
    expect(loggedLine()).toContain('GET /dashboard 201')
  })

  it('logs once with status 499 when the client disconnects before the response completes', async () => {
    const event = fakeEvent('/slow-report')

    await runMiddleware(event)
    disconnect(event)
    finish(event, 200)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('GET /slow-report 499')
    expect(log).not.toHaveBeenCalled()
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
