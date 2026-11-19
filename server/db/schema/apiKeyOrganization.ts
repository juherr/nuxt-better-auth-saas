// SPDX-License-Identifier: MIT
import { index, pgTable, text } from 'drizzle-orm/pg-core'
import { apiKey, organization } from './auth'

// Exact organization of an API key. Kept outside the generated auth.ts so
// that `pnpm auth:schema` does not drop it: better-auth's apiKey plugin
// cannot declare extra fields (its schema option only renames).
export const apiKeyOrganization = pgTable(
  'api_key_organization',
  {
    apiKeyId: text('api_key_id')
      .primaryKey()
      .references(() => apiKey.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' })
  },
  table => [
    index('api_key_organization_organizationId_idx').on(table.organizationId)
  ]
)
