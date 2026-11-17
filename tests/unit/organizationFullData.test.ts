import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals } from './support/nitroGlobals'

const getAuthSession = vi.hoisted(() => vi.fn())
const findOrganization = vi.hoisted(() => vi.fn())
const findSubscriptions = vi.hoisted(() => vi.fn())
const findMembers = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/auth', () => ({ getAuthSession }))
vi.mock('~~/server/utils/db', () => ({
  useDB: async () => ({
    query: {
      organization: { findFirst: findOrganization },
      subscription: { findMany: findSubscriptions },
      member: { findMany: findMembers }
    }
  })
}))

beforeAll(() => {
  stubNitroGlobals()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterAll(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const foreignOrg = {
  id: 'org-other',
  slug: 'other',
  createdAt: '2026-01-01T00:00:00Z',
  members: [{ userId: 'u-owner', role: 'owner', user: { id: 'u-owner', email: 'owner@other.test' } }],
  invitations: [{ id: 'inv-1', email: 'invitee@other.test' }]
}

async function callFullData() {
  return callRoute(() => import('~~/server/api/organization/full-data.get'), undefined)
}

describe('the organization full-data endpoint', () => {
  beforeEach(() => {
    getAuthSession.mockReset().mockResolvedValue({
      user: { id: 'u1', email: 'u1@example.test', name: 'U1' },
      session: { activeOrganizationId: 'org-other' }
    })
    findOrganization.mockReset().mockResolvedValue(foreignOrg)
    findSubscriptions.mockReset().mockResolvedValue([])
    findMembers.mockReset().mockResolvedValue([])
  })

  it('refuses an anonymous request without reading the database', async () => {
    getAuthSession.mockResolvedValue(null)

    await expect(callFullData()).rejects.toMatchObject({ statusCode: 401 })
    expect(findOrganization).not.toHaveBeenCalled()
  })

  it('refuses a session without a user', async () => {
    getAuthSession.mockResolvedValue({ session: { activeOrganizationId: 'org-other' } })

    await expect(callFullData()).rejects.toMatchObject({ statusCode: 401 })
    expect(findOrganization).not.toHaveBeenCalled()
  })

  it('refuses an active organization the user is not a member of, without leaking its data', async () => {
    const error = await callFullData().then(
      () => { throw new Error('expected the request to be refused') },
      (e: unknown) => e as Record<string, unknown>
    )

    expect(error).toMatchObject({ statusCode: 403 })
    const serialized = JSON.stringify({ ...error, message: error.message })
    expect(serialized).not.toContain('owner@other.test')
    expect(serialized).not.toContain('invitee@other.test')
    expect(serialized).not.toContain('"slug"')
    expect(findSubscriptions).not.toHaveBeenCalled()
    expect(findMembers).not.toHaveBeenCalled()
  })

  it('answers 404 when the active organization does not exist', async () => {
    findOrganization.mockResolvedValue(undefined)

    await expect(callFullData()).rejects.toMatchObject({ statusCode: 404 })
    expect(findSubscriptions).not.toHaveBeenCalled()
  })
})
