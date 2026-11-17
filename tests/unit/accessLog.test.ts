import { describe, expect, it } from 'vitest'
import {
  accessLogLevel,
  formatAccessLog,
  parseLogFormat,
  parseLogLevel,
  resolveRequestId,
  sanitizeLogPath,
  shouldLog
} from '~~/server/utils/accessLog'

const SECRET = 'c3Vw/er+secret=value&x'
const ENCODED_SECRET = encodeURIComponent(SECRET)
const timestamp = new Date('2026-01-02T03:04:05.000Z')

function entry(path: string, status = 200) {
  return { method: 'GET', path, status, durationMs: 12, requestId: 'req-1', timestamp }
}

function expectNoSecret(line: string) {
  expect(line).not.toContain(SECRET)
  expect(line).not.toContain(ENCODED_SECRET)
  expect(line).not.toContain('secret')
}

describe('sanitizeLogPath', () => {
  it.each([
    [`/reset-password?token=${ENCODED_SECRET}`, '/reset-password'],
    [`/api/auth/callback/github?code=${ENCODED_SECRET}&state=${ENCODED_SECRET}`, '/api/auth/callback/github'],
    [`/verify#token=${ENCODED_SECRET}`, '/verify'],
    [`/verify?a=1#token=${ENCODED_SECRET}`, '/verify'],
    [`/verify#frag?token=${ENCODED_SECRET}`, '/verify'],
    ['/?token=x', '/'],
    ['?token=x', '/']
  ])('drops the query and the fragment of %s', (input, expected) => {
    expect(sanitizeLogPath(input)).toBe(expected)
  })

  it('cuts at the first raw separator, before any decoding', () => {
    expect(sanitizeLogPath('/files/a%3Fb%23c?token=x')).toBe('/files/a%3Fb%23c')
  })

  it('keeps an encoded question mark in a segment as is, never as a query', () => {
    expect(sanitizeLogPath('/files/report%3Fdraft')).toBe('/files/report%3Fdraft')
  })

  it.each(['/bad/%E0%A4%A?token=x', '/bad/%?token=x', '/bad/%zz'])('does not throw on the malformed encoding %s', (input) => {
    expect(() => sanitizeLogPath(input)).not.toThrow()
    expect(sanitizeLogPath(input)).not.toContain('token')
  })

  it('keeps only the pathname of an absolute URL', () => {
    expect(sanitizeLogPath(`https://user:pass@app.example.test:8443/reset?token=${ENCODED_SECRET}#x`)).toBe('/reset')
    expect(sanitizeLogPath('https://app.example.test')).toBe('/')
  })

  it('escapes control characters so a path cannot forge a log line', () => {
    expect(sanitizeLogPath('/a\r\nGET /admin 200')).toBe('/a%0D%0AGET%20/admin%20200')
  })
})

describe('formatAccessLog', () => {
  it('writes one text line with the timestamp, method, path, status, duration and request id', () => {
    expect(formatAccessLog(entry('/dashboard?tab=1'), 'text'))
      .toBe('[2026-01-02T03:04:05.000Z] INFO GET /dashboard 200 12ms request_id=req-1')
  })

  it('writes one JSON object with a fixed set of keys', () => {
    const line = formatAccessLog(entry('/dashboard?tab=1', 503), 'json')

    expect(line).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-01-02T03:04:05.000Z',
      level: 'error',
      method: 'GET',
      path: '/dashboard',
      status: 503,
      durationMs: 12,
      requestId: 'req-1'
    })
  })

  it.each(['text', 'json'] as const)('never writes a token placed in the query or the fragment (%s)', (format) => {
    for (const path of [
      `/reset-password?token=${SECRET}`,
      `/reset-password?token=${ENCODED_SECRET}`,
      `/callback?code=${ENCODED_SECRET}&state=${ENCODED_SECRET}`,
      `/verify#token=${ENCODED_SECRET}`,
      `https://app.example.test/reset?token=${ENCODED_SECRET}`
    ]) {
      expectNoSecret(formatAccessLog(entry(path), format))
    }
  })
})

describe('log levels', () => {
  it.each([
    ['debug', 'debug'],
    ['INFO', 'info'],
    [' warn ', 'warn'],
    ['error', 'error'],
    ['', 'info'],
    [undefined, 'info'],
    ['verbose', 'info']
  ])('parses the level %j as %s', (input, expected) => {
    expect(parseLogLevel(input)).toBe(expected)
  })

  it.each([
    ['json', 'json'],
    ['JSON', 'json'],
    ['text', 'text'],
    ['', 'text'],
    [undefined, 'text'],
    ['xml', 'text']
  ])('parses the format %j as %s', (input, expected) => {
    expect(parseLogFormat(input)).toBe(expected)
  })

  it.each([
    [200, 'info'],
    [302, 'info'],
    [404, 'warn'],
    [499, 'warn'],
    [500, 'error'],
    [503, 'error']
  ])('logs a %i response at %s', (status, expected) => {
    expect(accessLogLevel(status)).toBe(expected)
  })

  it('keeps entries at or above the configured level', () => {
    expect(shouldLog('info', 'info')).toBe(true)
    expect(shouldLog('error', 'warn')).toBe(true)
    expect(shouldLog('debug', 'info')).toBe(false)
    expect(shouldLog('info', 'warn')).toBe(false)
    expect(shouldLog('warn', 'error')).toBe(false)
    expect(shouldLog('debug', 'debug')).toBe(true)
  })
})

describe('resolveRequestId', () => {
  it('keeps an inbound id made of safe characters', () => {
    expect(resolveRequestId('abc-123_DEF.4:5')).toBe('abc-123_DEF.4:5')
    expect(resolveRequestId('a'.repeat(128))).toBe('a'.repeat(128))
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['oversized', 'a'.repeat(129)],
    ['with CRLF', 'abc\r\nx-injected: 1'],
    ['with a space', 'abc def'],
    ['with a slash', 'abc/def']
  ])('generates a UUID when the inbound id is %s', (_label, header) => {
    const id = resolveRequestId(header)

    expect(id).not.toBe(header)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
