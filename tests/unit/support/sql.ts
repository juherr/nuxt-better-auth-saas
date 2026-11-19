// SPDX-License-Identifier: MIT
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const dialect = new PgDialect()

/** Renders a drizzle condition captured by a fake to its Postgres SQL text and params. */
export function renderSql(condition: unknown) {
  return dialect.sqlToQuery(condition as SQL)
}
