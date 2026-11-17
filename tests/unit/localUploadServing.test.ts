import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { locateLocalUpload } from '~~/server/services/file/localServing'
import { stubNitroGlobals } from './support/nitroGlobals'

let root: string
let uploadDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nss-local-serving-'))
  uploadDir = join(root, 'uploads')
  await mkdir(join(uploadDir, '2026-03-02'), { recursive: true })
  await mkdir(join(root, 'uploads-other'), { recursive: true })
  await writeFile(join(uploadDir, '2026-03-02', 'abc.png'), 'png-bytes')
  await writeFile(join(uploadDir, '2026-03-02', 'abc.pdf'), 'pdf')
  await writeFile(join(uploadDir, 'legacy.html'), '<p>legacy</p>')
  await writeFile(join(root, 'uploads-other', 'kept.png'), 'kept')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('locating a local upload to serve', () => {
  it('serves an image inline with its type and size', async () => {
    const upload = await locateLocalUpload(uploadDir, '2026-03-02/abc.png')

    expect(upload).toMatchObject({
      filePath: join(uploadDir, '2026-03-02', 'abc.png'),
      size: 9,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })

  it('serves a non-image type as an attachment', async () => {
    const upload = await locateLocalUpload(uploadDir, '2026-03-02/abc.pdf')

    expect(upload?.headers['Content-Disposition']).toBe('attachment')
  })

  it('serves a legacy HTML name as an opaque attachment', async () => {
    const upload = await locateLocalUpload(uploadDir, 'legacy.html')

    expect(upload?.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff'
    })
  })

  it.each([
    ['a parent directory', '../uploads-other/kept.png'],
    ['an encoded parent directory', '%2e%2e/uploads-other/kept.png'],
    ['an absolute path', '/etc/hosts'],
    ['the directory itself', ''],
    ['a sub-directory', '2026-03-02'],
    ['a missing file', '2026-03-02/missing.png'],
    ['a malformed encoding', '%E0%A4%A']
  ])('finds nothing for %s', async (_label, path) => {
    expect(await locateLocalUpload(uploadDir, path)).toBeUndefined()
  })
})

describe('the local uploads handler', () => {
  const serveStatic = vi.fn()

  beforeAll(() => {
    stubNitroGlobals()
    vi.stubGlobal('serveStatic', serveStatic)
    vi.stubGlobal('useRuntimeConfig', () => ({
      fileManager: { storage: { local: { uploadDir, publicPath: '/uploads' } } }
    }))
  })
  beforeEach(() => {
    serveStatic.mockReset().mockImplementation(async (_event, options) => {
      const meta = await options.getMeta('/ignored')
      if (!meta) {
        throw Object.assign(new Error('Not Found'), { statusCode: 404 })
      }
      return meta
    })
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  const newEvent = (path: string) => ({ params: { _: path }, responseHeaders: {} as Record<string, string> })
  const handle = async (event: ReturnType<typeof newEvent>) => {
    const { default: handler } = await import('~~/server/handlers/localUploads')
    return (handler as (event: unknown) => Promise<unknown>)(event)
  }
  const call = async (path: string) => {
    const event = newEvent(path)
    const result = await handle(event)
    return { event, result }
  }

  it('sets the serving headers before handing the file to serveStatic', async () => {
    const { event, result } = await call('2026-03-02/abc.pdf')

    expect(event.responseHeaders).toEqual({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff'
    })
    expect(result).toMatchObject({ type: 'application/pdf', size: 3 })
    expect(serveStatic).toHaveBeenCalledWith(event, expect.objectContaining({ indexNames: [] }))
  })

  it('answers 404 with nosniff for a path outside the upload directory', async () => {
    const event = newEvent('../uploads-other/kept.png')

    await expect(handle(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(event.responseHeaders).toEqual({ 'x-content-type-options': 'nosniff' })
  })
})
