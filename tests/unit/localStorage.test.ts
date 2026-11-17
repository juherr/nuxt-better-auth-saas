import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageProvider } from '~~/server/services/file/storage/local'

describe('the local storage provider', () => {
  let root: string
  let uploadDir: string
  let provider: LocalStorageProvider

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nss-local-storage-'))
    uploadDir = join(root, 'uploads')
    // A sibling whose name starts with the upload directory's name.
    await mkdir(join(root, 'uploads-other'), { recursive: true })
    await writeFile(join(root, 'uploads-other', 'kept.txt'), 'kept')
    provider = new LocalStorageProvider(uploadDir, '/uploads')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('writes a dated name into a new sub-directory', async () => {
    const result = await provider.upload(Buffer.from('data'), '2026-03-02/abc.png')

    expect(result).toEqual({ path: '2026-03-02/abc.png', url: '/uploads/2026-03-02/abc.png' })
    expect(await readFile(join(uploadDir, '2026-03-02', 'abc.png'), 'utf8')).toBe('data')
    expect(await provider.exists('2026-03-02/abc.png')).toBe(true)
  })

  it('still deletes a legacy flat name', async () => {
    await mkdir(uploadDir, { recursive: true })
    await writeFile(join(uploadDir, 'legacy.png'), 'old')

    await provider.delete('legacy.png')

    expect(await provider.exists('legacy.png')).toBe(false)
  })

  const outside = [
    ['a parent directory', '../escape.png'],
    ['a sibling sharing the prefix', '../uploads-other/kept.txt'],
    ['an absolute path', '/etc/hosts'],
    ['the directory itself', '.'],
    ['a nested parent directory', '2026-03-02/../../escape.png']
  ]

  it.each(outside)('refuses to write %s', async (_label, path) => {
    await expect(provider.upload(Buffer.from('data'), path!)).rejects.toThrow('outside the upload directory')
    await expect(readFile(join(root, 'escape.png'))).rejects.toThrow()
  })

  it.each(outside)('refuses to delete %s', async (_label, path) => {
    await expect(provider.delete(path!)).rejects.toThrow('outside the upload directory')
    expect(await readFile(join(root, 'uploads-other', 'kept.txt'), 'utf8')).toBe('kept')
  })

  it.each(outside)('refuses to check %s', async (_label, path) => {
    await expect(provider.exists(path!)).rejects.toThrow('outside the upload directory')
  })
})
