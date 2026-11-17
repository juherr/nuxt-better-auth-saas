import { eq } from 'drizzle-orm'
import { apiKey, apiKeyOrganization } from '~~/server/db/schema'
import { requireApiKeyManager } from '~~/server/utils/apiKeyAccess'
import { requireAuthSession } from '~~/server/utils/billing'
import { useDB } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)

  const { organizationId } = getQuery(event)
  if (typeof organizationId !== 'string' || !organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  await requireApiKeyManager(event, organizationId)

  // A key is listed only through its exact organization link. Legacy keys
  // that were not backfilled have no link and are never listed.
  const db = await useDB()
  return db
    .select({
      id: apiKey.id,
      name: apiKey.name,
      start: apiKey.start,
      prefix: apiKey.prefix,
      enabled: apiKey.enabled,
      createdAt: apiKey.createdAt,
      lastRequest: apiKey.lastRequest,
      expiresAt: apiKey.expiresAt
    })
    .from(apiKey)
    .innerJoin(apiKeyOrganization, eq(apiKeyOrganization.apiKeyId, apiKey.id))
    .where(eq(apiKeyOrganization.organizationId, organizationId))
})
