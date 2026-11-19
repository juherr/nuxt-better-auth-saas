// SPDX-License-Identifier: MIT
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MODE_RESTRICTED } from '~~/shared/utils/demoMode'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const runtimeConfig = vi.hoisted(() => ({ public: { demoMode: false } }))
const findMany = vi.hoisted(() => vi.fn(async () => []))
const useDB = vi.hoisted(() => vi.fn())

// The query builder chains both routes use, answering empty results.
function fakeDB() {
  const query = new Proxy({}, { get: () => ({ findMany }) })
  return {
    query,
    select: () => ({
      from: () => ({
        where: async () => [{ count: 0 }],
        groupBy: () => ({ $dynamic: async () => [] })
      })
    })
  }
}

beforeAll(() => {
  stubNitroGlobals()
  vi.stubGlobal('eventHandler', (handler: unknown) => handler)
  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
  vi.stubGlobal('useDB', useDB)
  vi.stubGlobal('getValidatedQuery', async (event: { query?: unknown }, parse: (value: unknown) => unknown) =>
    parse(event.query ?? {}))
  vi.stubGlobal('getValidatedRouterParams', async (event: { params?: unknown }, parse: (value: unknown) => unknown) =>
    parse(event.params ?? {}))
})
beforeEach(() => {
  runtimeConfig.public.demoMode = false
  useDB.mockReset()
  useDB.mockImplementation(async () => fakeDB())
  findMany.mockClear()
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const list = (tableName: string, query: Record<string, unknown> = {}) =>
  callRoute(() => import('~~/server/api/admin/list/[tableName].get'), undefined, query, { tableName })

const countBy = (tableName: string, columnName: string) =>
  callRoute(() => import('~~/server/api/admin/count/[tableName]/[columnName].get'), undefined, {}, { tableName, columnName })

const HIDDEN_TABLES = ['auditLog', 'session', 'account', 'verification', 'rateLimit', 'apiKey']

describe('the admin list route in demo mode', () => {
  it.each(HIDDEN_TABLES)('refuses the %s table', async (tableName) => {
    runtimeConfig.public.demoMode = true
    await expect(list(tableName)).rejects.toMatchObject({ statusCode: 403, data: { code: DEMO_MODE_RESTRICTED } })
    expect(useDB).not.toHaveBeenCalled()
  })

  it('lists the session table outside the demo', async () => {
    await expect(list('session')).resolves.toMatchObject({ data: [], total: 0 })
    expect(findMany).toHaveBeenCalled()
  })

  it.each(['user', 'organization', 'member', 'invitation', 'subscription'])('lists the %s table', async (tableName) => {
    runtimeConfig.public.demoMode = true
    await expect(list(tableName)).resolves.toMatchObject({ data: [], total: 0 })
    expect(findMany).toHaveBeenCalled()
  })

  it('refuses a relation into a hidden table', async () => {
    runtimeConfig.public.demoMode = true
    await expect(list('user', { with: JSON.stringify({ accounts: true }) }))
      .rejects
      .toMatchObject({ statusCode: 403, data: { code: DEMO_MODE_RESTRICTED } })
    expect(useDB).not.toHaveBeenCalled()
  })

  it('refuses a nested relation into a hidden table', async () => {
    runtimeConfig.public.demoMode = true
    const nested = { members: { with: { user: { with: { accounts: true } } } } }
    await expect(list('organization', { with: JSON.stringify(nested) }))
      .rejects
      .toMatchObject({ statusCode: 403, data: { code: DEMO_MODE_RESTRICTED } })
    expect(useDB).not.toHaveBeenCalled()
  })

  it('refuses a relation into a hidden table enabled with a config object', async () => {
    runtimeConfig.public.demoMode = true
    await expect(list('user', { with: JSON.stringify({ accounts: {} }) }))
      .rejects
      .toMatchObject({ statusCode: 403, data: { code: DEMO_MODE_RESTRICTED } })
  })

  // drizzle drops falsy `with` entries before loading, so they read nothing.
  it.each([
    ['a disabled relation', { accounts: false }],
    ['a null relation', { accounts: null }],
    ['a disabled nested relation', { members: { with: { user: { with: { accounts: false } } } } }]
  ])('lets %s into a hidden table through', async (_label, withRelations) => {
    runtimeConfig.public.demoMode = true
    await list('organization', { with: JSON.stringify(withRelations) })
    expect(findMany).toHaveBeenCalled()
  })

  it('keeps the relations the admin pages load', async () => {
    runtimeConfig.public.demoMode = true
    await list('organization', { with: JSON.stringify({ members: { with: { user: true } } }) })
    expect(findMany).toHaveBeenCalled()
  })

  it('lets a relation into a hidden table through outside the demo', async () => {
    await list('user', { with: JSON.stringify({ accounts: true }) })
    expect(findMany).toHaveBeenCalled()
  })
})

describe('the admin count route in demo mode', () => {
  it.each([
    ['session', 'ipAddress'],
    ['auditLog', 'userAgent'],
    ['account', 'password']
  ])('refuses %s.%s', async (tableName, columnName) => {
    runtimeConfig.public.demoMode = true
    await expect(countBy(tableName, columnName))
      .rejects
      .toMatchObject({ statusCode: 403, data: { code: DEMO_MODE_RESTRICTED } })
    expect(useDB).not.toHaveBeenCalled()
  })

  it('counts session.ipAddress outside the demo', async () => {
    await expect(countBy('session', 'ipAddress')).resolves.toEqual([])
    expect(useDB).toHaveBeenCalled()
  })

  it('counts user.role in the demo', async () => {
    runtimeConfig.public.demoMode = true
    await expect(countBy('user', 'role')).resolves.toEqual([])
    expect(useDB).toHaveBeenCalled()
  })
})
