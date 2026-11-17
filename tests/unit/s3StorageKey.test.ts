import { describe, expect, it } from 'vitest'
import { assertStorageKey } from '~~/server/services/file/storage/s3-compatible'

describe('an S3-compatible object key', () => {
  it.each(['2026-03-02/abc.png', 'legacy.png'])('accepts %s', (key) => {
    expect(assertStorageKey(key)).toBe(key)
  })

  it.each([
    ['an empty key', ''],
    ['a backslash', '2026-03-02\\..\\abc.png'],
    ['a NUL byte', 'abc.png\u0000'],
    ['an empty segment', '2026-03-02//abc.png'],
    ['a trailing slash', '2026-03-02/'],
    ['a dot segment', './abc.png']
  ])('refuses %s', (_label, key) => {
    expect(() => assertStorageKey(key)).toThrow('outside the bucket')
  })
})
