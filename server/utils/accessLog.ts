/**
 * Access log policy: what a request line contains and when it is written.
 *
 * Pure functions, no framework import, so the redaction rules are tested
 * directly. The line never carries headers, bodies, the query string or the
 * fragment: those can hold reset tokens, OAuth codes or session identifiers.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFormat = 'text' | 'json'

export interface AccessLogEntry {
  method: string
  path: string
  status: number
  durationMs: number
  requestId: string
  timestamp: Date
}

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']
const FORMATS: readonly LogFormat[] = ['text', 'json']

/** `NUXT_LOG_LEVEL`: unset, empty or unknown values fall back to `info`. */
export function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim().toLowerCase()
  return LEVELS.find(candidate => candidate === level) ?? 'info'
}

/** `NUXT_LOG_FORMAT`: unset, empty or unknown values fall back to `text`. */
export function parseLogFormat(value: string | undefined): LogFormat {
  const format = value?.trim().toLowerCase()
  return FORMATS.find(candidate => candidate === format) ?? 'text'
}

/** 5xx responses are errors, 4xx warnings, everything else info. */
export function accessLogLevel(status: number): LogLevel {
  if (status >= 500) {
    return 'error'
  }
  if (status >= 400) {
    return 'warn'
  }
  return 'info'
}

/** Whether an entry at `entryLevel` passes the configured minimum level. */
export function shouldLog(entryLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LEVELS.indexOf(entryLevel) >= LEVELS.indexOf(configuredLevel)
}

const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i
// Control characters, space and DEL: escaped so a path cannot split or forge a line.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\x00-\x1F\x20\x7F]/g

/**
 * Returns the path of a request URL without its query string or fragment.
 *
 * The URL is cut at the first raw `?` or `#` before anything else, and the
 * path is logged as received (still percent-encoded): it is never decoded, so
 * a malformed encoding cannot throw and an encoded `%3F` or `%23` inside a
 * segment stays part of the path instead of becoming a separator. An absolute
 * URL keeps only its pathname.
 */
export function sanitizeLogPath(url: string): string {
  const cut = url.search(/[?#]/)
  const withoutQuery = cut === -1 ? url : url.slice(0, cut)
  const path = withoutQuery.replace(ABSOLUTE_URL, '')
  const escaped = path.replace(UNSAFE_CHARS, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
  return escaped.startsWith('/') ? escaped : `/${escaped}`
}

/** Formats one access log line; the path is always passed through `sanitizeLogPath`. */
export function formatAccessLog(entry: AccessLogEntry, format: LogFormat): string {
  const level = accessLogLevel(entry.status)
  const timestamp = entry.timestamp.toISOString()
  const path = sanitizeLogPath(entry.path)
  if (format === 'json') {
    return JSON.stringify({
      timestamp,
      level,
      method: entry.method,
      path,
      status: entry.status,
      durationMs: entry.durationMs,
      requestId: entry.requestId
    })
  }
  return `[${timestamp}] ${level.toUpperCase()} ${entry.method} ${path} ${entry.status} ${entry.durationMs}ms request_id=${entry.requestId}`
}

const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/

/**
 * Returns the inbound `x-request-id` when it is 1-128 characters of
 * `[A-Za-z0-9._:-]`, otherwise a new UUID (global Web Crypto, available on
 * Node 18+ and Cloudflare Workers).
 */
export function resolveRequestId(header: string | undefined): string {
  return header && SAFE_REQUEST_ID.test(header) ? header : crypto.randomUUID()
}
