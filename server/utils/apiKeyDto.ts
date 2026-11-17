/**
 * What the app shows of an API key. The stored row also holds the key
 * hash, its owner, permissions and client metadata; none of them leave
 * the server.
 */
export interface ApiKeyDto {
  id: string
  name: string | null
  start: string | null
  prefix: string | null
  enabled: boolean | null
  createdAt: Date
  lastRequest: Date | null
  expiresAt: Date | null
}

/** Copies the display fields only, whatever else the row carries. */
export function toApiKeyDto(row: ApiKeyDto): ApiKeyDto {
  return {
    id: row.id,
    name: row.name,
    start: row.start,
    prefix: row.prefix,
    enabled: row.enabled,
    createdAt: row.createdAt,
    lastRequest: row.lastRequest,
    expiresAt: row.expiresAt
  }
}
