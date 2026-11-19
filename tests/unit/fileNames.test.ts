// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { buildStorageName, MAX_DISPLAY_NAME_LENGTH, sanitizeDisplayName } from '~~/server/services/file/fileNames'

describe('buildStorageName', () => {
  it('builds <UTC date>/<id>.<extension>', () => {
    // 23:30 on March 1st in New York is already March 2nd in UTC.
    expect(buildStorageName(new Date('2026-03-01T23:30:00-05:00'), 'abc', 'png')).toBe('2026-03-02/abc.png')
  })
})

describe('sanitizeDisplayName', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeDisplayName('My avatar.png')).toBe('My avatar.png')
  })

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\photo.png', 'photo.png'],
    ['dir/sub/', 'file'],
    ['..', 'file'],
    ['', 'file']
  ])('drops directory parts from %j', (name, expected) => {
    expect(sanitizeDisplayName(name)).toBe(expected)
  })

  it('removes control characters, NUL included', () => {
    expect(sanitizeDisplayName('a\u0000b\u001Fc\u007F.png')).toBe('abc.png')
  })

  it(`truncates to ${MAX_DISPLAY_NAME_LENGTH} characters`, () => {
    expect(sanitizeDisplayName(`${'x'.repeat(5000)}.png`)).toHaveLength(MAX_DISPLAY_NAME_LENGTH)
  })
})
