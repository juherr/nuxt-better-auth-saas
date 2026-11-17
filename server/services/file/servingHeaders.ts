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

/** Type of a stored file from its extension, `application/octet-stream` when unknown. */
export const typeOfStorageName = (name: string) => {
  const base = name.split('/').pop()!
  const dot = base.lastIndexOf('.')
  return (dot > 0 && typeOfExtension(base.slice(dot + 1))) || OPAQUE_TYPE
}

export const servingHeaders = (mimeType: string) => ({
  'Content-Type': mimeType,
  'Content-Disposition': contentDisposition(mimeType),
  'X-Content-Type-Options': 'nosniff'
})
