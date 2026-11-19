// SPDX-License-Identifier: MIT
import { getDBStats } from '~~/server/utils/dbStats'

export default defineEventHandler(async () => {
  return getDBStats()
})
