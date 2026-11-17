import type { LogLevel } from '~~/server/utils/accessLog'
import {
  accessLogLevel,
  formatAccessLog,
  parseLogFormat,
  parseLogLevel,
  resolveRequestId,
  shouldLog
} from '~~/server/utils/accessLog'
import { runtimeConfig } from '~~/server/utils/runtimeConfig'

const write: Record<LogLevel, (line: string) => void> = {
  debug: line => console.log(line),
  info: line => console.log(line),
  warn: line => console.warn(line),
  error: line => console.error(line)
}

/**
 * Access log: one line per request once the response is sent, plus an
 * `x-request-id` response header. See server/utils/accessLog.ts for what a
 * line contains; headers and bodies are never logged.
 *
 * The line is written on the response's `finish` event rather than Nitro's
 * `afterResponse` hook: h3 skips `onAfterResponse` when Nitro's error handler
 * has sent an error response (h3 `toNodeListener`, `if (event.handled) return`),
 * so thrown 4xx/5xx would go unlogged. `finish` fires on both presets: on
 * `node-server` from the real `ServerResponse`, on `cloudflare-module` from
 * the `node-mock-http` response Nitro's `localFetch` builds (its `end()` emits
 * `finish`). The listener is skipped if a runtime ever lacks `on`.
 */
export default defineEventHandler((event) => {
  const start = performance.now()
  const requestId = resolveRequestId(getRequestHeader(event, 'x-request-id'))
  setResponseHeader(event, 'x-request-id', requestId)

  // Captured now: h3 rewrites the path as the request goes through its layers.
  const { method, path } = event
  const res = event.node?.res
  if (typeof res?.on !== 'function') {
    return
  }
  res.on('finish', () => {
    const status = getResponseStatus(event)
    const level = accessLogLevel(status)
    if (!shouldLog(level, parseLogLevel(runtimeConfig.logLevel))) {
      return
    }
    const durationMs = Math.round(performance.now() - start)
    const line = formatAccessLog(
      { method, path, status, durationMs, requestId, timestamp: new Date() },
      parseLogFormat(runtimeConfig.logFormat)
    )
    write[level](line)
  })
})
