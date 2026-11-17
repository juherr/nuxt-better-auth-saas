import { sql } from 'drizzle-orm'
import { getDB } from '~~/server/utils/db'
import { isDatabaseConfigured } from '~~/server/utils/drivers'

// Bounds the probe: the shared pg pool sets no connection timeout, so an
// unreachable database would otherwise keep the request open indefinitely.
const DATABASE_CHECK_TIMEOUT_MS = 2000

const checkDatabase = async () => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`database check timed out after ${DATABASE_CHECK_TIMEOUT_MS} ms`)),
      DATABASE_CHECK_TIMEOUT_MS
    )
  })
  try {
    await Promise.race([getDB().execute(sql`select 1`), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// Public liveness and readiness probe. Every supported runtime needs a
// database, so the app is only ready once one is configured and answers a
// trivial query in time. The failure body stays generic: the cause, which may
// contain connection details, is only logged on the server.
export default defineEventHandler(async (event) => {
  if (!isDatabaseConfigured()) {
    console.error('[health] no database configured')
    setResponseStatus(event, 503)
    return { status: 'error' }
  }
  try {
    await checkDatabase()
  } catch (error) {
    console.error('[health] database check failed:', error)
    setResponseStatus(event, 503)
    return { status: 'error' }
  }
  return { status: 'ok' }
})
