// SPDX-License-Identifier: MIT
import { promises as fs } from 'node:fs'
import { servingHeaders, typeOfStorageName } from './servingHeaders'
import { resolveRealInside } from './storage/local'

export interface LocalUpload {
  filePath: string
  size: number
  mtime: Date
  headers: ReturnType<typeof servingHeaders>
}

const decode = (path: string) => {
  try {
    return decodeURIComponent(path)
  } catch {
    return undefined
  }
}

/**
 * File under `uploadDir` for the URL-encoded `requestPath`, with the headers
 * to serve it with. `undefined` for anything that is not a regular file
 * inside `uploadDir`, symbolic links included.
 */
export const locateLocalUpload = async (uploadDir: string, requestPath: string): Promise<LocalUpload | undefined> => {
  const path = decode(requestPath)
  if (!path) {
    return undefined
  }
  let filePath: string
  try {
    filePath = await resolveRealInside(uploadDir, path)
  } catch {
    return undefined
  }
  const stats = await fs.stat(filePath).catch(() => undefined)
  if (!stats?.isFile()) {
    return undefined
  }
  return { filePath, size: stats.size, mtime: stats.mtime, headers: servingHeaders(typeOfStorageName(filePath)) }
}
