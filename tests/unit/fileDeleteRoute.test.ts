import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, stubNitroGlobals, stubRequestContext, TEST_AGENT, TEST_IP } from './support/nitroGlobals'

const getFile = vi.hoisted(() => vi.fn())
const deleteFile = vi.hoisted(() => vi.fn())
const requireAuth = vi.hoisted(() => vi.fn())

vi.mock('~~/server/services/file/fileService', () => ({
  FileService: class {
    getFile = getFile
    deleteFile = deleteFile
  },
  useFileManagerConfig: () => ({ storage: { provider: 'local' } })
}))
vi.mock('~~/server/services/file/storage/factory', () => ({
  createStorageProvider: async () => ({ name: 'test' })
}))

beforeAll(() => {
  stubNitroGlobals()
  vi.stubGlobal('requireAuth', requireAuth)
  stubRequestContext()
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const OWNER = { id: 'owner', role: 'user' }
const remove = (id = 'f1') =>
  callRoute<{ success: boolean }>(() => import('~~/server/api/file/[id].delete'), undefined, undefined, { id })

describe('deleting a file', () => {
  beforeEach(() => {
    getFile.mockReset().mockImplementation(async (id: string) => id === 'f1' ? { id, uploadedBy: OWNER.id } : null)
    deleteFile.mockReset().mockResolvedValue(true)
    requireAuth.mockReset().mockResolvedValue(OWNER)
  })

  it('lets the owner delete the file and records who did it', async () => {
    await expect(remove()).resolves.toMatchObject({ success: true })

    expect(deleteFile).toHaveBeenCalledWith('f1', OWNER.id, TEST_IP, TEST_AGENT)
  })

  it('lets an admin delete another user\'s file and records the admin', async () => {
    requireAuth.mockResolvedValue({ id: 'admin', role: 'admin' })

    await expect(remove()).resolves.toMatchObject({ success: true })

    expect(deleteFile).toHaveBeenCalledWith('f1', 'admin', TEST_IP, TEST_AGENT)
  })

  it.each([
    ['another user', { id: 'other', role: 'user' }],
    ['another user without a role', { id: 'other' }],
    ['another user with a non-admin role', { id: 'other', role: 'moderator' }]
  ])('refuses %s with 403', async (_label, user) => {
    requireAuth.mockResolvedValue(user)

    await expect(remove()).rejects.toMatchObject({ statusCode: 403 })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('refuses an anonymous request with 401', async () => {
    requireAuth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))

    await expect(remove()).rejects.toMatchObject({ statusCode: 401 })
    expect(getFile).not.toHaveBeenCalled()
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown file', async () => {
    await expect(remove('unknown')).rejects.toMatchObject({ statusCode: 404 })
    expect(deleteFile).not.toHaveBeenCalled()
  })
})
