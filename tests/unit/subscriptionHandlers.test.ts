import { beforeEach, describe, expect, it, vi } from 'vitest'
import { member as memberTable } from '~~/server/db/schema'
import { removeExcessMembersOnExpiration } from '~~/server/utils/subscription-handlers'
import { renderSql } from './support/sql'

const db = vi.hoisted(() => {
  const where = vi.fn(async (_condition: unknown) => undefined)
  const deleteFrom = vi.fn((_table: unknown) => ({ where }))
  const findMany = vi.fn()
  return { where, deleteFrom, findMany }
})

vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({ query: { member: { findMany: db.findMany } }, delete: db.deleteFrom })
}))

function memberRow(id: string, role: string) {
  return { id, role, userId: `user-${id}`, organizationId: 'org-1', user: { email: `${id}@example.com` } }
}

describe('removeExcessMembersOnExpiration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('keeps a member holding owner among several roles and removes the others', async () => {
    db.findMany.mockResolvedValue([memberRow('a', 'owner,admin'), memberRow('b', 'member')])

    const result = await removeExcessMembersOnExpiration('org-1')

    expect(result).toEqual({ removedCount: 1, removedMembers: [{ email: 'b@example.com', role: 'member' }] })
    expect(db.deleteFrom).toHaveBeenCalledWith(memberTable)
    const query = renderSql(db.where.mock.calls[0]![0])
    expect(query.sql).toContain('not (\',\' || replace("member"."role", \' \', \'\') || \',\' like $')
    expect(query.sql).not.toMatch(/\\|~|regexp/i)
    expect(query.params).toEqual(['org-1', '%,owner,%'])
  })

  it('keeps a plain owner and removes the others', async () => {
    db.findMany.mockResolvedValue([memberRow('a', 'owner'), memberRow('b', 'admin')])

    const result = await removeExcessMembersOnExpiration('org-1')

    expect(result?.removedCount).toBe(1)
    expect(result?.removedMembers).toEqual([{ email: 'b@example.com', role: 'admin' }])
  })
})
