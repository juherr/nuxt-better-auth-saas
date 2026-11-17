import { eq } from 'drizzle-orm'
import { apiKey, apiKeyOrganization } from '~~/server/db/schema'
import { requireApiKeyManager } from '~~/server/utils/apiKeyAccess'
import { requireAuthSession } from '~~/server/utils/billing'
import { useDB } from '~~/server/utils/db'

const keyNotFound = () => createError({ statusCode: 404, statusMessage: 'API key not found' })

/**
 * Revokes a key of an organization the caller manages. An unknown key, a
 * key without organization link, another organization's key and a caller
 * who does not manage the key's organization all get the same 404, checked
 * before anything is deleted.
 */
export default defineEventHandler(async (event) => {
  await requireAuthSession(event)

  const keyId = getRouterParam(event, 'id')
  if (!keyId) {
    throw createError({ statusCode: 400, statusMessage: 'Key ID is required' })
  }

  const db = await useDB()
  const link = await db.query.apiKeyOrganization.findFirst({
    where: eq(apiKeyOrganization.apiKeyId, keyId)
  })
  if (!link) {
    throw keyNotFound()
  }

  try {
    await requireApiKeyManager(event, link.organizationId)
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 403) {
      throw keyNotFound()
    }
    throw error
  }

  await db.delete(apiKey).where(eq(apiKey.id, keyId))

  return { success: true }
})
