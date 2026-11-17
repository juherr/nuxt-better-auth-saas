import type { LogLevel } from '~~/server/utils/accessLog'
import {
  accessLogLevel,
  formatAccessLog,
  isNuxtErrorPageSubrequest,
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

// nginx's convention for a request the client closed before the response completed.
const CLIENT_CLOSED_REQUEST = 499

/**
 * Access log: one line per request, plus an `x-request-id` response header.
 * The sub-request Nuxt makes to render an HTML error page is not logged: the
 * request that failed already is (see `isNuxtErrorPageSubrequest`).
 * See server/utils/accessLog.ts for what a line contains; headers and bodies
 * are never logged.
 *
 * No single signal fires for every request, so the line is written by the
 * first of three, and only once:
 * - the response's `finish` event: the only one after Nitro's error handler
 *   has sent an error response, since h3 `toNodeListener` then returns on
 *   `event.handled` before `onAfterResponse` (h3 1.15.4);
 * - Nitro's `afterResponse` hook (server/plugins/accessLog.ts): the only one
 *   for a streamed body on `cloudflare-module`, where h3 `sendStream` never
 *   ends a response without a socket and node-mock-http drops its listeners;
 * - the response's `close` event: the only one when a Node client
 *   disconnects first, logged with status 499. node-mock-http emits `close`
 *   before `finish`, so a completed response (`writableFinished`) keeps its
 *   real status.
 */
export default defineEventHandler((event) => {
  const start = performance.now()
  const requestId = resolveRequestId(getRequestHeader(event, 'x-request-id'))
  setResponseHeader(event, 'x-request-id', requestId)
  const req = event.node?.req
  const res = event.node?.res
  // Nuxt renders error pages through a `/__nuxt_error` sub-request that
  // forwards the request headers and copies its response headers back
  // (@nuxt/nitro-server runtime/handlers/error.js): forwarding the resolved
  // id keeps one id for the request, its sub-request and the response.
  if (req?.headers) {
    req.headers['x-request-id'] = requestId
  }

  // Captured now: h3 rewrites the path as the request goes through its layers.
  const { method, path } = event
  // The error page sub-request shares the request id; the failed request's own line covers it.
  if (isNuxtErrorPageSubrequest({
    path,
    nuxtErrorHeader: getRequestHeader(event, 'x-nuxt-error'),
    internal: !!req && '__unenv__' in req
  })) {
    return
  }
  let written = false
  const writeOnce = (status: number) => {
    if (written) {
      return
    }
    written = true
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
  }

  const writeFromResponse = () => writeOnce(getResponseStatus(event))
  event.context.writeAccessLog = writeFromResponse
  if (typeof res?.on !== 'function') {
    return
  }
  res.on('finish', writeFromResponse)
  res.on('close', () => writeOnce(res.writableFinished ? getResponseStatus(event) : CLIENT_CLOSED_REQUEST))
})
