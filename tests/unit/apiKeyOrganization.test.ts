import { describe, expect, it, vi } from 'vitest'
import { apiKey } from '~~/server/db/schema'
import { deleteOrganizationApiKeys } from '~~/server/utils/apiKeyOrganization'
import { renderSql } from './support/sql'

function fakeDB() {
  const where = vi.fn(async (_condition: unknown) => undefined)
  const deleteFrom = vi.fn((_table: unknown) => ({ where }))
  return { db: { delete: deleteFrom }, deleteFrom, where }
}

describe('deleteOrganizationApiKeys', () => {
  it('deletes only the API keys linked to the deleted organization', async () => {
    const { db, deleteFrom, where } = fakeDB()

    await deleteOrganizationApiKeys(db as never, 'org-1')

    expect(deleteFrom).toHaveBeenCalledTimes(1)
    expect(deleteFrom).toHaveBeenCalledWith(apiKey)
    const query = renderSql(where.mock.calls[0]![0])
    expect(query.sql).toBe(
      '"apiKey"."id" in (select "api_key_id" from "api_key_organization"'
      + ' where "api_key_organization"."organization_id" = $1)'
    )
    expect(query.params).toEqual(['org-1'])
  })

  it('lets a failed deletion propagate so the organization is not deleted without its keys', async () => {
    const { db, where } = fakeDB()
    where.mockRejectedValue(new Error('delete failed'))

    await expect(deleteOrganizationApiKeys(db as never, 'org-1')).rejects.toThrow('delete failed')
  })
})
