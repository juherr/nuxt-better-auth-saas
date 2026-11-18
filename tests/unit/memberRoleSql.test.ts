import { not } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { member } from '~~/server/db/schema'
import { memberHasRoleSql } from '~~/server/utils/memberRoleSql'
import { renderSql } from './support/sql'

describe('memberHasRoleSql', () => {
  it('matches the role as a whole entry of the comma-separated list, through a bound LIKE pattern', () => {
    const query = renderSql(memberHasRoleSql(member.role, 'owner'))

    expect(query.sql).toBe('(\',\' || replace("member"."role", \' \', \'\') || \',\' like $1)')
    expect(query.params).toEqual(['%,owner,%'])
  })

  it('renders no regex nor backslash, so no escaping can be lost on the way to Postgres', () => {
    const query = renderSql(not(memberHasRoleSql(member.role, 'owner')))

    expect(query.sql).not.toMatch(/\\|~|regexp|similar/i)
    expect(query.sql.startsWith('not (')).toBe(true)
  })

  it('refuses a role name that could act as a LIKE wildcard', () => {
    expect(() => memberHasRoleSql(member.role, 'own%' as never)).toThrow()
    expect(() => memberHasRoleSql(member.role, 'own_r' as never)).toThrow()
    expect(() => memberHasRoleSql(member.role, '' as never)).toThrow()
  })
})
