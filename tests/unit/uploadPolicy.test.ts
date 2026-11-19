// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import {
  checkDeclaredBodyLength,
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  maxUploadBodySize,
  MULTIPART_OVERHEAD_BYTES,
  resolveAllowedMimeTypes,
  resolveMaxFileSize
} from '~~/server/services/file/uploadPolicy'
import { generateRuntimeConfig } from '~~/server/utils/runtimeConfig'

describe('the upload defaults', () => {
  it('limits files to 5 MB of the four avatar image types', () => {
    expect(DEFAULT_MAX_FILE_SIZE).toBe(5 * 1024 * 1024)
    expect(DEFAULT_ALLOWED_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  })

  it('are declared in the runtime config so they can be overridden at runtime', () => {
    const { fileManager } = generateRuntimeConfig()

    expect(fileManager.maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE)
    expect(fileManager.allowedMimeTypes).toEqual(DEFAULT_ALLOWED_MIME_TYPES)
  })
})

describe('resolveMaxFileSize', () => {
  it.each([
    [1024, 1024],
    ['2048', 2048]
  ])('keeps a configured size of %s', (value, expected) => {
    expect(resolveMaxFileSize(value)).toBe(expected)
  })

  it.each([undefined, null, '', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'abc'])(
    'falls back to the default for %s instead of lifting the limit',
    (value) => {
      expect(resolveMaxFileSize(value)).toBe(DEFAULT_MAX_FILE_SIZE)
    }
  )
})

describe('resolveAllowedMimeTypes', () => {
  it('keeps a configured list, normalized', () => {
    expect(resolveAllowedMimeTypes([' Image/PNG ', 'image/jpeg'])).toEqual(['image/png', 'image/jpeg'])
  })

  it('reads a comma-separated string, as set from an environment variable', () => {
    expect(resolveAllowedMimeTypes('image/png, image/webp')).toEqual(['image/png', 'image/webp'])
  })

  it.each([undefined, null, '', [], ' , ', 42])('falls back to the defaults for %s instead of allowing every type', (value) => {
    expect(resolveAllowedMimeTypes(value)).toEqual(DEFAULT_ALLOWED_MIME_TYPES)
  })
})

describe('checkDeclaredBodyLength', () => {
  const max = maxUploadBodySize(1000)

  it('allows one file of the maximum size plus a fixed multipart overhead', () => {
    expect(max).toBe(1000 + MULTIPART_OVERHEAD_BYTES)
    expect(checkDeclaredBodyLength(String(max), undefined, max)).toEqual({ ok: true })
  })

  it('refuses a declared length above the maximum with 413', () => {
    expect(checkDeclaredBodyLength(String(max + 1), undefined, max)).toEqual({ ok: false, statusCode: 413 })
  })

  it.each([undefined, '', '10abc', '-1', '1e3', ' '])('requires a valid length (411) when it is %j', (value) => {
    expect(checkDeclaredBodyLength(value, undefined, max)).toEqual({ ok: false, statusCode: 411 })
  })

  it('requires a length (411) for a chunked body, even when a length is declared', () => {
    expect(checkDeclaredBodyLength(undefined, 'chunked', max)).toEqual({ ok: false, statusCode: 411 })
    expect(checkDeclaredBodyLength('10', 'gzip, chunked', max)).toEqual({ ok: false, statusCode: 411 })
  })
})
