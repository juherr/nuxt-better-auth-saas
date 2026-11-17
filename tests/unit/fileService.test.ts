import type { StorageProvider } from '~~/server/services/file/types'
import { Buffer } from 'node:buffer'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_DISPLAY_NAME_LENGTH } from '~~/server/services/file/fileNames'
import { FileService } from '~~/server/services/file/fileService'
import { stubNitroGlobals } from './support/nitroGlobals'

vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))

const insertedValues = vi.fn()

beforeAll(() => {
  stubNitroGlobals()
  vi.stubGlobal('formatFileSize', (bytes: number) => `${bytes} B`)
  vi.stubGlobal('useDB', async () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues(values)
        return { returning: async () => [values] }
      }
    })
  }))
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const PNG = { mimeType: 'image/png', extension: 'png' }
const STORAGE_NAME = /^\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/

function storage() {
  const upload = vi.fn<StorageProvider['upload']>(async (_file, name) => ({ path: name, url: `/uploads/${name}` }))
  const provider: StorageProvider = {
    name: 'test',
    upload: async (file, name, type) => upload(file, name, type),
    delete: vi.fn(),
    getUrl: name => `/uploads/${name}`,
    exists: vi.fn()
  }
  return { provider, upload }
}

describe('fileService.uploadFile', () => {
  beforeEach(() => {
    insertedValues.mockReset()
  })

  it.each([
    ['a parent directory path', '../../outside/avatar.png'],
    ['a NUL byte', 'avatar.png\u0000.html'],
    ['a very long name', `${'x'.repeat(5000)}.png`],
    ['another extension', 'avatar.html']
  ])('keeps a filename with %s out of the storage path', async (_label, filename) => {
    const { provider, upload } = storage()

    await new FileService(provider).uploadFile(Buffer.from('data'), filename, PNG, 'u1')

    const storedName = upload.mock.calls[0]![1]
    expect(storedName).toMatch(STORAGE_NAME)
    expect(insertedValues).toHaveBeenCalledWith(expect.objectContaining({ fileName: storedName, path: storedName }))
  })

  it('keeps the original name as display metadata only, sanitized and bounded', async () => {
    const { provider } = storage()

    await new FileService(provider).uploadFile(Buffer.from('data'), `../a\u0000${'b'.repeat(400)}.png`, PNG, 'u1')

    const { originalName } = insertedValues.mock.calls[0]![0]
    expect(originalName).toHaveLength(MAX_DISPLAY_NAME_LENGTH)
    expect(originalName).toMatch(/^ab+$/)
  })

  it('stores the detected type', async () => {
    const { provider, upload } = storage()

    await new FileService(provider).uploadFile(Buffer.from('data'), 'avatar.gif', PNG, 'u1')

    expect(upload.mock.calls[0]![2]).toBe('image/png')
    expect(insertedValues).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }))
  })

  it('dates the storage folder in UTC whatever the server time zone', async () => {
    vi.stubEnv('TZ', 'America/New_York')
    const { provider, upload } = storage()
    // 22:00 on March 1st in New York.
    const now = () => new Date('2026-03-02T03:00:00Z')

    await new FileService(provider, now).uploadFile(Buffer.from('data'), 'a.png', PNG, 'u1')

    expect(upload.mock.calls[0]![1]).toMatch(/^2026-03-02\//)
    vi.unstubAllEnvs()
  })
})
