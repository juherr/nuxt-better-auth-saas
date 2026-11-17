import { sql } from 'drizzle-orm'
import { getDB } from '~~/server/utils/db'
import { isDatabaseConfigured } from '~~/server/utils/drivers'

// Public liveness and readiness probe. When a database is configured, it must
// answer a trivial query. The failure body stays generic: the cause, which may
// contain connection details, is only logged on the server.
export default defineEventHandler(async (event) => {
  if (isDatabaseConfigured()) {
    try {
      await getDB().execute(sql`select 1`)
    } catch (error) {
      console.error('[health] database check failed:', error)
      setResponseStatus(event, 503)
      return { status: 'error' }
    }
  }
  return { status: 'ok' }
})
