declare module 'h3' {
  interface H3EventContext {
    /** Writes the request's access log line; set by server/middleware/0.common.ts, no-op after the first call. */
    writeAccessLog?: () => void
  }
}

/**
 * Writes the access log line from Nitro's `afterResponse` hook. On
 * `cloudflare-module`, a streamed body (a `Response` returned by a handler,
 * such as better-auth's) goes through h3 `sendStream`, which on a response
 * without a socket only marks the event handled: `end()` is never called, so
 * neither `finish` nor `close` fires, and this hook is the only signal.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', (event) => {
    event.context.writeAccessLog?.()
  })
})
