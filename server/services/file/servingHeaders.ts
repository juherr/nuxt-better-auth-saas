/**
 * Headers an uploaded file is served with, by every storage provider. Pure:
 * the type always comes from detected bytes or from a storage name built
 * from them, never from the client.
 */
import { typeOfExtension } from './contentSniffer'

/** Raster images a browser can show without running anything. SVG is not one. */
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Type of anything the sniffer table does not know, such as a legacy `.html` name. */
export const OPAQUE_TYPE = 'application/octet-stream'

/** `inline` for raster images only, `attachment` for every other type. */
export const contentDisposition = (mimeType: string) =>
  INLINE_TYPES.has(mimeType) ? 'inline' : 'attachment'

/**
 * Other spellings of a detected type's extension, found on files stored
 * before storage names were built from detected types. Serving only: new
 * names always use the sniffer table's extension.
 */
const LEGACY_EXTENSIONS = new Map([['jpeg', 'jpg'], ['jpe', 'jpg']])

/** Type of a stored file from its extension, `application/octet-stream` when unknown. */
export const typeOfStorageName = (name: string) => {
  const base = name.split('/').pop()!
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return OPAQUE_TYPE
  }
  const extension = base.slice(dot + 1).toLowerCase()
  return typeOfExtension(LEGACY_EXTENSIONS.get(extension) ?? extension) || OPAQUE_TYPE
}

export const servingHeaders = (mimeType: string) => ({
  'Content-Type': mimeType,
  'Content-Disposition': contentDisposition(mimeType),
  'X-Content-Type-Options': 'nosniff'
})
