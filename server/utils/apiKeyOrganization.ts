// SPDX-License-Identifier: MIT
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '~~/server/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { apiKey, apiKeyOrganization } from '~~/server/db/schema'

/**
 * Deletes the API keys of an organization that is about to be deleted.
 * Must run before the organization row goes: the cascade on
 * api_key_organization would otherwise drop the links and leave the keys
 * enabled with no organization to list or revoke them. Errors propagate
 * so that the organization deletion stops instead of leaving such keys.
 */
export async function deleteOrganizationApiKeys(
  db: Pick<NodePgDatabase<typeof schema>, 'delete'>,
  organizationId: string
) {
  const linkedKeyIds = new QueryBuilder()
    .select({ apiKeyId: apiKeyOrganization.apiKeyId })
    .from(apiKeyOrganization)
    .where(eq(apiKeyOrganization.organizationId, organizationId))
  await db.delete(apiKey).where(inArray(apiKey.id, linkedKeyIds))
}
