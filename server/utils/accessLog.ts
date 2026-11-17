/**
 * Access log policy: what a request line contains and when it is written.
 *
 * Pure functions, no framework import, so the redaction rules are tested
 * directly. The line never carries headers, bodies, the query string, the
 * fragment or a secret path segment: those can hold reset tokens, OAuth codes
 * or session identifiers.
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
// C0 controls, space, DEL, C1 controls (NEL among them) and the Unicode line
// and paragraph separators: escaped so a path cannot split or forge a line.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\x00-\x20\x7F-\x9F\u2028\u2029]/g

/**
 * Routes that carry a secret in the path itself: a value whose possession
 * grants an action, not an identifier. Everything after `prefix` is
 * replaced with `placeholder`, named after the route parameter.
 *
 * - `/api/auth/reset-password/:token`: better-auth's password reset link
 *   (`requestPasswordResetCallback`, better-auth 1.4.1).
 *
 * Other dynamic routes carry identifiers that need a session to act on, and
 * other better-auth tokens travel in the query, which is never logged.
 */
const SECRET_PATH_ROUTES: readonly { prefix: readonly string[], placeholder: string }[] = [
  { prefix: ['api', 'auth', 'reset-password'], placeholder: ':token' }
]

// One or more raw or percent-encoded slashes.
const SEPARATOR = '(?:/|%2F)+'

// Deliberately broader than the router: the prefix matches in any case, after
// any leading segments (an `app.baseURL`), across repeated or encoded slashes.
const SECRET_PATH_PATTERNS = SECRET_PATH_ROUTES.map(({ prefix, placeholder }) => ({
  pattern: new RegExp(`((?:^|/|%2F)${prefix.join(SEPARATOR)}${SEPARATOR}).+$`, 'i'),
  placeholder
}))

function redactSecretSegments(path: string): string {
  return SECRET_PATH_PATTERNS.reduce(
    (redacted, { pattern, placeholder }) => redacted.replace(pattern, (_match, kept: string) => `${kept}${placeholder}`),
    path
  )
}

/**
 * Returns the path of a request URL without its query string or fragment,
 * with the secret segments of `SECRET_PATH_ROUTES` replaced by a placeholder.
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
  const path = redactSecretSegments(withoutQuery.replace(ABSOLUTE_URL, ''))
  // Percent-encoded as UTF-8 bytes, like the rest of the path: `%0A`, `%C2%85`, `%E2%80%A8`.
  const escaped = path.replace(UNSAFE_CHARS, encodeURIComponent)
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
