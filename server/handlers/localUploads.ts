// SPDX-License-Identifier: MIT
import { createReadStream } from 'node:fs'
import { locateLocalUpload } from '~~/server/services/file/localServing'

/**
 * Serves files of the local storage provider under its public path. Nitro
 * `publicAssets` only serve the files present at build time and cannot set
 * headers per type, so nuxt.config.ts registers this handler instead when
 * `NUXT_APP_STORAGE` is `local`.
 *
 * Every response forbids content sniffing; only raster images are inline.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  const uploadDir = useRuntimeConfig().fileManager.storage.local?.uploadDir
  const upload = uploadDir ? await locateLocalUpload(uploadDir, getRouterParam(event, '_') ?? '') : undefined
  if (upload) {
    for (const [name, value] of Object.entries(upload.headers)) {
      setResponseHeader(event, name, value)
    }
  }
  return serveStatic(event, {
    indexNames: [],
    getMeta: () => upload && { type: upload.headers['Content-Type'], size: upload.size, mtime: upload.mtime },
    getContents: () => upload && createReadStream(upload.filePath)
  })
})
