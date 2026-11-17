import { describe, expect, it } from 'vitest'
import { contentDisposition, servingHeaders, typeOfStorageName } from '~~/server/services/file/servingHeaders'

describe('the headers an uploaded file is served with', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('shows %s inline', (type) => {
    expect(contentDisposition(type)).toBe('inline')
  })

  it.each([
    'image/svg+xml',
    'text/html',
    'application/pdf',
    'text/plain',
    'application/octet-stream'
  ])('downloads %s as an attachment', (type) => {
    expect(contentDisposition(type)).toBe('attachment')
  })

  it('always forbids content sniffing', () => {
    expect(servingHeaders('image/png')).toEqual({
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff'
    })
    expect(servingHeaders('application/pdf')).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff'
    })
  })

  it.each([
    ['2026-03-02/abc.png', 'image/png'],
    ['2026-03-02/abc.jpg', 'image/jpeg'],
    ['2026-03-02/abc.webp', 'image/webp'],
    ['2026-03-02/abc.gif', 'image/gif'],
    ['2026-03-02/abc.pdf', 'application/pdf'],
    ['2026-03-02/ABC.PNG', 'image/png']
  ])('types %s from the extensions of detected types', (name, type) => {
    expect(typeOfStorageName(name)).toBe(type)
  })

  it.each([
    ['legacy/photo.jpeg', 'image/jpeg'],
    ['legacy/photo.JPEG', 'image/jpeg'],
    ['legacy/photo.jpe', 'image/jpeg']
  ])('types the legacy JPEG name %s as JPEG', (name, type) => {
    expect(typeOfStorageName(name)).toBe(type)
  })

  it('shows a legacy .jpeg name inline as JPEG', () => {
    expect(servingHeaders(typeOfStorageName('x.jpeg'))).toEqual({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff'
    })
  })

  it.each([
    ['a legacy HTML name', 'legacy.html'],
    ['a legacy SVG name', 'legacy.svg'],
    ['a name without extension', '2026-03-02/abc'],
    ['a dot file', '.png'],
    ['an object property name as extension', 'abc.constructor']
  ])('serves %s as opaque bytes', (_label, name) => {
    expect(typeOfStorageName(name)).toBe('application/octet-stream')
  })
})
