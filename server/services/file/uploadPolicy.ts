// SPDX-License-Identifier: MIT
/**
 * Upload limits. Framework-free so the runtime config, the route and the
 * tests share one definition.
 */

/** Default maximum size of one uploaded file: 5 MB. */
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024

/** Default allowed types: uploads serve avatars only. */
export const DEFAULT_ALLOWED_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Number of files the upload route accepts in one request. */
export const MAX_FILES_PER_UPLOAD = 1

/**
 * Room for the multipart framing around the files: boundaries, part
 * headers, the client filename and any extra text fields.
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/** Largest request body the upload route reads. */
export const maxUploadBodySize = (maxFileSize: number) =>
  MAX_FILES_PER_UPLOAD * maxFileSize + MULTIPART_OVERHEAD_BYTES

/**
 * Configured file size limit, or the default when it is missing or not a
 * positive integer: a bad value must not lift the limit.
 */
export const resolveMaxFileSize = (value: unknown): number => {
  const size = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof size === 'number' && Number.isSafeInteger(size) && size > 0 ? size : DEFAULT_MAX_FILE_SIZE
}

/**
 * Configured allowed types, lower-cased. Accepts a list or a
 * comma-separated string (the form a runtime environment variable takes).
 * An empty or invalid value gives the defaults rather than allowing every
 * type.
 */
export const resolveAllowedMimeTypes = (value: unknown): string[] => {
  const items = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  const types = items
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
  return types.length > 0 ? types : [...DEFAULT_ALLOWED_MIME_TYPES]
}

export type BodyLengthCheck = { ok: true } | { ok: false, statusCode: 411 | 413 }

/**
 * Checks the declared request length before the body is read. h3 buffers a
 * chunked body until it ends, so a chunked body is refused even when a
 * length is also declared; Node caps a body at its declared length.
 */
export const checkDeclaredBodyLength = (
  contentLength: string | undefined,
  transferEncoding: string | undefined,
  maxBodySize: number
): BodyLengthCheck => {
  const chunked = (transferEncoding ?? '').split(',').some(coding => coding.trim().toLowerCase() === 'chunked')
  if (chunked || !contentLength || !/^\d+$/.test(contentLength)) {
    return { ok: false, statusCode: 411 }
  }
  return Number(contentLength) > maxBodySize ? { ok: false, statusCode: 413 } : { ok: true }
}
