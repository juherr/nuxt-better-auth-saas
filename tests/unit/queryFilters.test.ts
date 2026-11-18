import { getTableColumns } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { processFilters } from '~~/server/utils/query'
import { renderSql } from './support/sql'

// The admin list and count routes pass `getTableColumns(table)`: a plain
// object, so it inherits `toString`, `constructor` and the like.
const columns = getTableColumns(pgTable('widget', {
  name: text('name'),
  createdAt: timestamp('created_at')
}))

describe('processFilters', () => {
  it('ignores a column the table does not have', () => {
    expect(processFilters([{ col: 'missing', op: 'eq', v: 'x' }], columns)).toEqual([])
  })

  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'ignores the inherited key %s like an unknown column',
    (col) => {
      expect(processFilters([{ col, op: 'eq', v: 'x' }], columns)).toEqual([])
    }
  )

  it('filters an own column', () => {
    const [condition] = processFilters([{ col: 'name', op: 'eq', v: 'x' }], columns)

    expect(renderSql(condition)).toMatchObject({ sql: '"widget"."name" = $1', params: ['x'] })
  })

  it('keeps both bounds of a between filter inclusive', () => {
    const from = '2026-01-01T00:00:00.000Z'
    const to = '2026-02-01T00:00:00.000Z'
    const [condition] = processFilters([{ col: 'createdAt', op: 'between', v: [from, to] }], columns)

    expect(renderSql(condition)).toMatchObject({
      sql: '"widget"."created_at" between $1 and $2',
      params: [from, to]
    })
  })
})
