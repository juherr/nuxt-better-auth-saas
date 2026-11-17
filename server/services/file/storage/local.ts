import type { Buffer } from 'node:buffer'
import type { StorageProvider } from '../types'
import { promises as fs } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

/**
 * Absolute path of `path` inside `directory`.
 *
 * @throws {Error} when `path` resolves to the directory itself or outside it.
 */
export const resolveInside = (directory: string, path: string): string => {
  const root = resolve(directory)
  const filePath = resolve(root, path)
  if (!filePath.startsWith(root + sep)) {
    throw new Error('Storage path is outside the upload directory')
  }
  return filePath
}

export class LocalStorageProvider implements StorageProvider {
  name = 'local'
  private uploadDir: string
  private publicPath: string

  constructor(uploadDir: string, publicPath: string) {
    this.uploadDir = uploadDir
    this.publicPath = publicPath
  }

  private resolveInside(path: string): string {
    return resolveInside(this.uploadDir, path)
  }

  async upload(file: Buffer, fileName: string): Promise<{ path: string, url?: string }> {
    const filePath = this.resolveInside(fileName)

    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file)

    return {
      path: fileName,
      url: `${this.publicPath}/${fileName}`
    }
  }

  async delete(path: string): Promise<void> {
    const filePath = this.resolveInside(path)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw error
      }
    }
  }

  getUrl(path: string): string {
    return `${this.publicPath}/${path}`
  }

  /** @throws {Error} when `path` is outside the upload directory. */
  async exists(path: string): Promise<boolean> {
    const filePath = this.resolveInside(path)
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
