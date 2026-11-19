// SPDX-License-Identifier: MIT
import type { H3Event } from 'h3'
import { createTableRelationsHelpers, extractTablesRelationalConfig } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { DEMO_MODE_RESTRICTED } from '~~/shared/utils/demoMode'

/**
 * Tables the generic admin routes do not show in the public demo, whose
 * admin credentials are public: they hold visitor IPs and user agents,
 * session tokens, password hashes and OAuth tokens, verification values,
 * rate limit keys and API key hashes. Keys are the schema export names,
 * as the routes accept them.
 */
export const DEMO_HIDDEN_TABLES: readonly string[] = [
  'auditLog',
  'session',
  'account',
  'verification',
  'rateLimit',
  'apiKey'
]

// Relation names (on any table) that load rows of a hidden table, such as
// `user.accounts`: a `with` naming one would read the hidden table anyway.
const HIDDEN_RELATIONS: ReadonlySet<string> = (() => {
  const { tables } = extractTablesRelationalConfig(schema, createTableRelationsHelpers)
  const names = new Set<string>()
  for (const table of Object.values(tables)) {
    for (const [name, relation] of Object.entries(table.relations)) {
      const target = Object.entries(schema).find(([, value]) => value === relation.referencedTable)
      if (target && DEMO_HIDDEN_TABLES.includes(target[0])) {
        names.add(name)
      }
    }
  }
  return names
})()

// drizzle skips falsy `with` entries (`accounts: false`), which load nothing.
const namesHiddenRelation = (value: unknown): boolean =>
  value !== null && typeof value === 'object'
  && Object.entries(value).some(([key, nested]) =>
    Boolean(nested) && (HIDDEN_RELATIONS.has(key) || namesHiddenRelation(nested)))

/**
 * Whether the demo hides this read: a hidden table, or a relational
 * `with` (at any depth) that reaches one.
 */
export function isDemoHiddenAdminRead(tableName: string, withRelations?: unknown): boolean {
  return DEMO_HIDDEN_TABLES.includes(tableName) || namesHiddenRelation(withRelations)
}

/** Answers 403 `DEMO_MODE_RESTRICTED` in the demo when the read is hidden. */
export function refuseDemoHiddenAdminRead(event: H3Event, tableName: string, withRelations?: unknown) {
  if (useRuntimeConfig(event).public.demoMode && isDemoHiddenAdminRead(tableName, withRelations)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This table is hidden in the demo',
      data: { code: DEMO_MODE_RESTRICTED }
    })
  }
}
