import { describe, expect, it } from 'vitest'
import { checkUploadContent, isActiveContentType, sniffContentType } from '~~/server/services/file/contentSniffer'

const bytes = (...values: Array<number | string>) => new Uint8Array(values.flatMap(v =>
  typeof v === 'string' ? Array.from(v, c => c.charCodeAt(0)) : [v]))

const PNG = bytes(0x89, 'PNG', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D)
const JPEG = bytes(0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 'JFIF')
const GIF = bytes('GIF89a', 1, 0, 1, 0)
const WEBP = bytes('RIFF', 0x24, 0, 0, 0, 'WEBPVP8 ')
const PDF = bytes('%PDF-1.7\n')
const HTML = bytes('<!DOCTYPE html><script>1</script>')
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
const EXE = bytes('MZ', 0x90, 0)

const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

describe('sniffContentType', () => {
  it.each([
    ['png', PNG, { mimeType: 'image/png', extension: 'png' }],
    ['jpeg', JPEG, { mimeType: 'image/jpeg', extension: 'jpg' }],
    ['gif', GIF, { mimeType: 'image/gif', extension: 'gif' }],
    ['webp', WEBP, { mimeType: 'image/webp', extension: 'webp' }],
    ['pdf', PDF, { mimeType: 'application/pdf', extension: 'pdf' }]
  ])('recognizes %s by its leading bytes', (_label, data, expected) => {
    expect(sniffContentType(data)).toEqual(expected)
  })

  it.each([
    ['html', HTML],
    ['svg', SVG],
    ['an executable', EXE],
    ['an empty file', new Uint8Array()],
    ['a RIFF file that is not webp', bytes('RIFF', 0, 0, 0, 0, 'WAVE')],
    ['a truncated png signature', PNG.subarray(0, 4)]
  ])('recognizes nothing in %s', (_label, data) => {
    expect(sniffContentType(data)).toBeUndefined()
  })
})

describe('isActiveContentType', () => {
  it.each([
    'image/svg+xml',
    'text/html',
    'application/xhtml+xml',
    'text/xml',
    'application/xml',
    'text/javascript',
    'application/javascript',
    'application/x-msdownload',
    'application/x-sh'
  ])('flags %s', (type) => {
    expect(isActiveContentType(type)).toBe(true)
  })

  it.each(['image/png', 'image/jpeg', 'application/pdf'])('does not flag %s', (type) => {
    expect(isActiveContentType(type)).toBe(false)
  })
})

describe('checkUploadContent', () => {
  it.each([
    ['image/png', PNG, 'image/png'],
    ['image/jpeg', JPEG, 'image/jpeg'],
    ['IMAGE/GIF; charset=binary', GIF, 'image/gif'],
    ['image/webp', WEBP, 'image/webp']
  ])('accepts %s with matching bytes', (declared, data, detected) => {
    expect(checkUploadContent(declared, data, IMAGES)).toMatchObject({ ok: true, type: { mimeType: detected } })
  })

  it('refuses bytes of another allowed type than the declared one', () => {
    expect(checkUploadContent('image/png', JPEG, IMAGES)).toEqual({ ok: false, reason: 'mismatch' })
  })

  it.each([['html', HTML], ['svg', SVG], ['an executable', EXE]])('refuses %s declared as png', (_label, data) => {
    expect(checkUploadContent('image/png', data, IMAGES)).toEqual({ ok: false, reason: 'unrecognized' })
  })

  it('refuses a recognized type that is not allowed', () => {
    expect(checkUploadContent('application/pdf', PDF, IMAGES)).toEqual({ ok: false, reason: 'not-allowed' })
  })

  it('accepts pdf only when configured', () => {
    expect(checkUploadContent('application/pdf', PDF, [...IMAGES, 'application/pdf'])).toMatchObject({ ok: true })
  })

  it('refuses a missing declared type', () => {
    expect(checkUploadContent(undefined, PNG, IMAGES)).toEqual({ ok: false, reason: 'mismatch' })
  })

  it.each(['image/svg+xml', 'text/html', 'application/x-msdownload'])(
    'refuses %s even when it is configured as allowed',
    (type) => {
      expect(checkUploadContent(type, SVG, [...IMAGES, type])).toEqual({ ok: false, reason: 'active-content' })
    }
  )
})
