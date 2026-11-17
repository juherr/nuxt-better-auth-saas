// No imports on purpose: scripts/backfill-api-key-organization.ts runs this
// module under plain Node (type stripping), outside Nuxt and its aliases.

const MAX_JSON_DECODES = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the organization id that legacy API keys carried in their metadata.
 *
 * Accepts an already parsed object, a JSON string, or a JSON string of a
 * JSON string (the double encoding older clients produced). Anything else,
 * including a missing, non-string or blank `organizationId`, yields null:
 * there is no fuzzy fallback.
 */
export function parseLegacyOrganizationId(metadata: unknown): string | null {
  let value = metadata
  for (let decodes = 0; typeof value === 'string' && decodes < MAX_JSON_DECODES; decodes++) {
    try {
      value = JSON.parse(value)
    }
    catch {
      return null
    }
  }
  if (!isRecord(value) || typeof value.organizationId !== 'string')
    return null
  const organizationId = value.organizationId.trim()
  return organizationId === '' ? null : organizationId
}

export type ApiKeyBackfillOutcome
  = | 'link'
    | 'already-linked'
    | 'skipped-invalid'
    | 'skipped-unknown-org'
    | 'skipped-not-manager'

/**
 * Organization roles that may create, list and revoke the organization's
 * API keys. The stored role must match exactly: a role list or another
 * casing does not count.
 */
export const API_KEY_MANAGER_ROLES = ['owner', 'admin'] as const

export function isApiKeyManagerRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && (API_KEY_MANAGER_ROLES as readonly string[]).includes(role)
}

/**
 * The id of the key an API key creation returned, or null when it
 * returned an error or anything without a usable id. Reads the id only:
 * the same object carries the plaintext key, which must not be kept.
 */
export function createdApiKeyId(returned: unknown): string | null {
  if (!isRecord(returned) || returned instanceof Error)
    return null
  return typeof returned.id === 'string' && returned.id !== '' ? returned.id : null
}

/**
 * Decides what the backfill does with one legacy API key. Legacy metadata
 * was set by the client and never checked, so a key is linked only when
 * its owner currently manages (exact role `owner` or `admin`) the
 * organization the metadata names.
 */
export function decideApiKeyBackfill(input: {
  alreadyLinked: boolean
  organizationId: string | null
  organizationExists: boolean
  ownerRole: string | null
}): ApiKeyBackfillOutcome {
  if (input.alreadyLinked)
    return 'already-linked'
  if (input.organizationId === null)
    return 'skipped-invalid'
  if (!input.organizationExists)
    return 'skipped-unknown-org'
  if (!isApiKeyManagerRole(input.ownerRole))
    return 'skipped-not-manager'
  return 'link'
}
