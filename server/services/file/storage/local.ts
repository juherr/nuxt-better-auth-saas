import type { Buffer } from 'node:buffer'
import type { StorageProvider } from '../types'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

const outsideError = () => new Error('Storage path is outside the upload directory')

/**
 * Absolute path of `path` inside `directory`.
 *
 * @throws {Error} when `path` resolves to the directory itself or outside it.
 */
const resolveInside = (directory: string, path: string): string => {
  const root = resolve(directory)
  const filePath = resolve(root, path)
  if (!filePath.startsWith(root + sep)) {
    throw outsideError()
  }
  return filePath
}

/**
 * Real path of `path` with every link resolved. A missing tail is appended
 * to the real path of its closest existing parent; a link whose target is
 * missing has no real path and is refused.
 */
const realPathOf = async (path: string): Promise<string> => {
  try {
    return await fs.realpath(path)
  } catch (error) {
    const parent = dirname(path)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === path) {
      throw error
    }
    if (await fs.lstat(path).then(() => true, () => false)) {
      throw outsideError()
    }
    return join(await realPathOf(parent), basename(path))
  }
}

/**
 * Like {@link resolveInside}, and also refuses a path that symbolic links
 * lead outside the real upload directory.
 *
 * @throws {Error} when `path` or the file it leads to is outside the directory.
 */
export const resolveRealInside = async (directory: string, path: string): Promise<string> => {
  const filePath = resolveInside(directory, path)
  const [root, real] = await Promise.all([realPathOf(resolve(directory)), realPathOf(filePath)])
  if (!real.startsWith(root + sep)) {
    throw outsideError()
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

  private resolveInside(path: string): Promise<string> {
    return resolveRealInside(this.uploadDir, path)
  }

  async upload(file: Buffer, fileName: string): Promise<{ path: string, url?: string }> {
    const filePath = await this.resolveInside(fileName)

    await fs.mkdir(dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file)

    return {
      path: fileName,
      url: `${this.publicPath}/${fileName}`
    }
  }

  async delete(path: string): Promise<void> {
    const filePath = await this.resolveInside(path)
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
    const filePath = await this.resolveInside(path)
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
