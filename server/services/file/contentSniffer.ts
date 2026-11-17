/**
 * Detects an upload's type from its leading bytes. Pure, no dependency:
 * the declared multipart type is client input and is only trusted when the
 * bytes agree with it.
 */

export interface DetectedType {
  mimeType: string
  /** Extension used for the storage name, without the dot. */
  extension: string
}

interface Signature extends DetectedType {
  /** Byte values at `offset`; `undefined` matches any byte. */
  bytes: Array<number | undefined>
  offset?: number
}

const ascii = (text: string) => Array.from(text, c => c.charCodeAt(0))

const SIGNATURES: Signature[] = [
  { mimeType: 'image/png', extension: 'png', bytes: [0x89, ...ascii('PNG'), 0x0D, 0x0A, 0x1A, 0x0A] },
  { mimeType: 'image/jpeg', extension: 'jpg', bytes: [0xFF, 0xD8, 0xFF] },
  { mimeType: 'image/gif', extension: 'gif', bytes: ascii('GIF87a') },
  { mimeType: 'image/gif', extension: 'gif', bytes: ascii('GIF89a') },
  { mimeType: 'image/webp', extension: 'webp', bytes: [...ascii('RIFF'), undefined, undefined, undefined, undefined, ...ascii('WEBP')] },
  // Accepted only when listed in the allowed types.
  { mimeType: 'application/pdf', extension: 'pdf', bytes: ascii('%PDF-') }
]

const matches = (data: Uint8Array, { bytes, offset = 0 }: Signature) =>
  data.length >= offset + bytes.length && bytes.every((byte, i) => byte === undefined || data[offset + i] === byte)

/** Type recognized from the leading bytes, or `undefined` for anything outside the table. */
export const sniffContentType = (data: Uint8Array): DetectedType | undefined => {
  const signature = SIGNATURES.find(candidate => matches(data, candidate))
  return signature && { mimeType: signature.mimeType, extension: signature.extension }
}

const EXECUTABLE_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-sharedlib',
  'application/x-sh',
  'application/x-csh',
  'text/x-shellscript',
  'application/java-archive'
])

const ACTIVE_MARKERS = ['svg', 'html', 'xml', 'javascript', 'ecmascript']

/** Strips parameters and case from a media type: `Image/PNG; x=y` -> `image/png`. */
const normalizeType = (type: string) => type.split(';')[0]!.trim().toLowerCase()

/**
 * Types a browser may render or run (SVG, HTML, XML, scripts) and
 * executables. Always refused, even when configured as allowed.
 */
export const isActiveContentType = (type: string) => {
  const normalized = normalizeType(type)
  return EXECUTABLE_TYPES.has(normalized) || ACTIVE_MARKERS.some(marker => normalized.includes(marker))
}

export type ContentCheck =
  | { ok: true, type: DetectedType }
  | { ok: false, reason: 'active-content' | 'unrecognized' | 'not-allowed' | 'mismatch' }

/**
 * Accepts an upload only when its bytes are a recognized type that is
 * allowed, not active content, and the same as the declared type.
 */
export const checkUploadContent = (
  declaredType: string | undefined,
  data: Uint8Array,
  allowedTypes: readonly string[]
): ContentCheck => {
  const declared = normalizeType(declaredType ?? '')
  if (isActiveContentType(declared)) {
    return { ok: false, reason: 'active-content' }
  }
  const detected = sniffContentType(data)
  if (!detected) {
    return { ok: false, reason: 'unrecognized' }
  }
  const allowed = allowedTypes.map(normalizeType).filter(type => !isActiveContentType(type))
  if (!allowed.includes(detected.mimeType)) {
    return { ok: false, reason: 'not-allowed' }
  }
  if (declared !== detected.mimeType) {
    return { ok: false, reason: 'mismatch' }
  }
  return { ok: true, type: detected }
}
