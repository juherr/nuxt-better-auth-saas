import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const getAuthSession = vi.hoisted(() => vi.fn())
const memberships = vi.hoisted(() => ({ current: {} as Record<string, string> }))
const findMember = vi.hoisted(() => vi.fn())
const findLink = vi.hoisted(() => vi.fn())
const selectedRows = vi.hoisted(() => ({ current: [] as unknown[] }))
const select = vi.hoisted(() => vi.fn())
const deleteWhere = vi.hoisted(() => vi.fn(async (_where: unknown) => undefined))
const deleteFrom = vi.hoisted(() => vi.fn((_table: unknown) => ({ where: deleteWhere })))

vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      member: { findFirst: findMember },
      apiKeyOrganization: { findFirst: findLink }
    },
    select,
    delete: deleteFrom
  })
}))

beforeAll(stubNitroGlobals)

const dialect = new PgDialect()
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL)

/** Answers a membership lookup from `memberships`, keyed by the exact organization id queried. */
function memberLookup({ where }: { where: SQL }) {
  const [organizationId = '', userId] = render(where).params as string[]
  const role = memberships.current[organizationId]
  return Promise.resolve(role ? { organizationId, userId, role } : undefined)
}

interface SelectQuery { columns: Record<string, unknown>, join?: { kind: string, on: unknown }, where?: unknown }
let selectQueries: SelectQuery[]

function selectChain(columns: Record<string, unknown>) {
  const query: SelectQuery = { columns }
  selectQueries.push(query)
  const chain = {
    from: () => chain,
    innerJoin: (_table: unknown, on: unknown) => {
      query.join = { kind: 'inner', on }
      return chain
    },
    leftJoin: (_table: unknown, on: unknown) => {
      query.join = { kind: 'left', on }
      return chain
    },
    where: async (where: unknown) => {
      query.where = where
      return selectedRows.current
    }
  }
  return chain
}

const listKeys = (organizationId?: string) =>
  callRoute<unknown[]>(() => import('~~/server/api/organization/api-keys.get'), undefined, { organizationId })
const deleteKey = (id: string) =>
  callRoute(() => import('~~/server/api/organization/api-keys/[id].delete'), undefined, undefined, { id })

const errorOf = (promise: Promise<unknown>) => promise.then(() => undefined, (e: unknown) => e)

describe('organization API key routes', () => {
  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
    memberships.current = { 'org-1': 'owner' }
    findMember.mockReset().mockImplementation(memberLookup)
    findLink.mockReset().mockResolvedValue(undefined)
    selectedRows.current = []
    selectQueries = []
    select.mockReset().mockImplementation(selectChain)
    deleteFrom.mockClear()
    deleteWhere.mockClear()
  })

  describe('listing', () => {
    it('refuses an anonymous caller with 401 before reading anything', async () => {
      getAuthSession.mockResolvedValue(null)

      await expect(listKeys('org-1')).rejects.toMatchObject({ statusCode: 401 })
      expect(findMember).not.toHaveBeenCalled()
      expect(select).not.toHaveBeenCalled()
    })

    it('answers 400 when no organization is named', async () => {
      await expect(listKeys()).rejects.toMatchObject({ statusCode: 400 })
      expect(select).not.toHaveBeenCalled()
    })

    it('refuses an ordinary member and a non-member with the same 403, without listing', async () => {
      memberships.current = { 'org-1': 'member' }
      const asMember = await errorOf(listKeys('org-1'))
      memberships.current = {}
      const asStranger = await errorOf(listKeys('org-1'))

      expect(asMember).toMatchObject({ statusCode: 403 })
      expect(asStranger).toMatchObject({ statusCode: 403, statusMessage: (asMember as any).statusMessage })
      expect(select).not.toHaveBeenCalled()
    })

    it.each(['owner', 'admin'])('lets the organization %s list its keys', async (role) => {
      memberships.current = { 'org-1': role }

      await expect(listKeys('org-1')).resolves.toEqual([])
    })

    it('lists only keys linked to exactly the requested organization, not to one whose id contains it', async () => {
      memberships.current = { 'org-1': 'owner', 'org-12': 'owner' }

      await listKeys('org-1')

      const [query] = selectQueries
      const where = render(query!.where)
      expect(where.sql).toBe('"api_key_organization"."organization_id" = $1')
      expect(where.params).toEqual(['org-1'])
    })

    it('lists a key only through its organization link, so an unlinked legacy key is never listed', async () => {
      await listKeys('org-1')

      const [query] = selectQueries
      expect(query!.join?.kind).toBe('inner')
      expect(render(query!.join!.on).sql).toBe('"api_key_organization"."api_key_id" = "apiKey"."id"')
      expect(render(query!.where).sql).not.toMatch(/metadata|like/i)
    })
  })

  describe('revoking', () => {
    it('refuses an anonymous caller with 401 before any lookup', async () => {
      getAuthSession.mockResolvedValue(null)

      await expect(deleteKey('key-1')).rejects.toMatchObject({ statusCode: 401 })
      expect(findLink).not.toHaveBeenCalled()
      expect(deleteFrom).not.toHaveBeenCalled()
    })

    it('finds the key\'s organization by the exact key id', async () => {
      await errorOf(deleteKey('key-1'))

      expect(render(findLink.mock.calls[0]![0].where)).toMatchObject({
        sql: '"api_key_organization"."api_key_id" = $1',
        params: ['key-1']
      })
    })

    it.each(['owner', 'admin'])('lets the %s of the key\'s organization revoke it', async (role) => {
      memberships.current = { 'org-1': role }
      findLink.mockResolvedValue({ apiKeyId: 'key-1', organizationId: 'org-1' })

      await expect(deleteKey('key-1')).resolves.toEqual({ success: true })
      expect(deleteFrom).toHaveBeenCalledTimes(1)
      expect(render(deleteWhere.mock.calls[0]![0])).toMatchObject({ sql: '"apiKey"."id" = $1', params: ['key-1'] })
    })

    it('answers the same 404 for an unknown key, an unlinked legacy key, another organization\'s key and a member, deleting nothing', async () => {
      memberships.current = { 'org-1': 'owner', 'org-2': 'member' }
      const refusals = []

      findLink.mockResolvedValue(undefined)
      refusals.push(await errorOf(deleteKey('key-unknown')))
      refusals.push(await errorOf(deleteKey('key-legacy')))
      findLink.mockResolvedValue({ apiKeyId: 'key-12', organizationId: 'org-12' })
      refusals.push(await errorOf(deleteKey('key-12')))
      findLink.mockResolvedValue({ apiKeyId: 'key-2', organizationId: 'org-2' })
      refusals.push(await errorOf(deleteKey('key-2')))

      for (const refusal of refusals) {
        expect(refusal).toMatchObject({ statusCode: 404, statusMessage: (refusals[0] as any).statusMessage })
      }
      expect(deleteFrom).not.toHaveBeenCalled()
    })
  })
})
