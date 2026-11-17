import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    vi.restoreAllMocks()
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

  describe('through symbolic links', () => {
    beforeEach(async () => {
      await mkdir(uploadDir, { recursive: true })
      await symlink(join(root, 'uploads-other'), join(uploadDir, 'linked-dir'))
      await symlink(join(root, 'uploads-other', 'kept.txt'), join(uploadDir, 'linked-out.txt'))
    })

    it('refuses to write under a linked directory outside the upload directory', async () => {
      await expect(provider.upload(Buffer.from('data'), 'linked-dir/new.png')).rejects.toThrow('outside the upload directory')
      await expect(readFile(join(root, 'uploads-other', 'new.png'))).rejects.toThrow()
    })

    it('refuses to write through a link to a file outside the upload directory', async () => {
      await expect(provider.upload(Buffer.from('data'), 'linked-out.txt')).rejects.toThrow('outside the upload directory')
      expect(await readFile(join(root, 'uploads-other', 'kept.txt'), 'utf8')).toBe('kept')
    })

    it('refuses to write through a dangling link to a path outside the upload directory', async () => {
      await symlink(join(root, 'uploads-other', 'created.png'), join(uploadDir, 'dangling.png'))

      await expect(provider.upload(Buffer.from('data'), 'dangling.png')).rejects.toThrow('outside the upload directory')
      await expect(readFile(join(root, 'uploads-other', 'created.png'))).rejects.toThrow()
    })

    it('refuses to delete under a linked directory outside the upload directory', async () => {
      await expect(provider.delete('linked-dir/kept.txt')).rejects.toThrow('outside the upload directory')
      expect(await readFile(join(root, 'uploads-other', 'kept.txt'), 'utf8')).toBe('kept')
    })

    it('refuses to check through a link outside the upload directory', async () => {
      await expect(provider.exists('linked-out.txt')).rejects.toThrow('outside the upload directory')
    })

    it('refuses to write through a link at the final name, even to a file inside the upload directory', async () => {
      await mkdir(join(uploadDir, '2026-03-02'), { recursive: true })
      await writeFile(join(uploadDir, '2026-03-02', 'stored.png'), 'stored')
      await symlink(join(uploadDir, '2026-03-02', 'stored.png'), join(uploadDir, '2026-03-02', 'new.png'))

      await expect(provider.upload(Buffer.from('data'), '2026-03-02/new.png')).rejects.toThrow()
      expect(await readFile(join(uploadDir, '2026-03-02', 'stored.png'), 'utf8')).toBe('stored')
    })

    it('refuses to write when the directory is swapped for a link while it is created', async () => {
      vi.spyOn(fs, 'mkdir').mockImplementation(async (path) => {
        // Another process wins the race and plants a link to the outside.
        await symlink(join(root, 'uploads-other'), path as string)
        return undefined
      })

      await expect(provider.upload(Buffer.from('data'), '2026-03-03/new.png')).rejects.toThrow('outside the upload directory')
      await expect(readFile(join(root, 'uploads-other', 'new.png'))).rejects.toThrow()
    })

    it('still writes when the upload directory itself is reached through a link', async () => {
      const linkedDir = join(root, 'uploads-link')
      await symlink(uploadDir, linkedDir)
      const linked = new LocalStorageProvider(linkedDir, '/uploads')

      await linked.upload(Buffer.from('data'), '2026-03-02/abc.png')

      expect(await readFile(join(uploadDir, '2026-03-02', 'abc.png'), 'utf8')).toBe('data')
    })
  })
})
