import { describe, expect, it } from 'vitest'
import { decideApiKeyBackfill, parseLegacyOrganizationId } from '~~/server/utils/apiKeyMetadata'

describe('parseLegacyOrganizationId', () => {
  it.each([
    ['a JSON object string', JSON.stringify({ organizationId: 'org-1' }), 'org-1'],
    ['a double-encoded JSON string', JSON.stringify(JSON.stringify({ organizationId: 'org-12' })), 'org-12'],
    ['an already parsed object', { organizationId: 'org-1' }, 'org-1'],
    ['an object with other fields', { organizationId: 'org-1', label: 'ci' }, 'org-1'],
    ['an id surrounded by whitespace', { organizationId: '  org-1  ' }, 'org-1']
  ])('reads the organization id from %s', (_label, metadata, expected) => {
    expect(parseLegacyOrganizationId(metadata)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a non-JSON string', 'not json'],
    ['a truncated JSON string', '{"organizationId":"org-1"'],
    ['a JSON string of a plain string', JSON.stringify('org-1')],
    ['a JSON string of null', 'null'],
    ['a JSON number', '42'],
    ['a number', 42],
    ['a boolean', true],
    ['an array', [{ organizationId: 'org-1' }]],
    ['a JSON array string', JSON.stringify([{ organizationId: 'org-1' }])],
    ['an object without organizationId', { other: 'org-1' }],
    ['a numeric organizationId', { organizationId: 1 }],
    ['an object organizationId', { organizationId: { id: 'org-1' } }],
    ['an empty organizationId', { organizationId: '' }],
    ['a whitespace organizationId', { organizationId: '   ' }],
    ['a triple-encoded JSON string', JSON.stringify(JSON.stringify(JSON.stringify({ organizationId: 'org-1' })))]
  ])('returns null for %s', (_label, metadata) => {
    expect(parseLegacyOrganizationId(metadata)).toBeNull()
  })
})

describe('decideApiKeyBackfill', () => {
  const linkable = {
    alreadyLinked: false,
    organizationId: 'org-1',
    organizationExists: true,
    ownerRole: 'owner'
  }

  it.each(['owner', 'admin'])('links a key whose owner is %s of the organization', (ownerRole) => {
    expect(decideApiKeyBackfill({ ...linkable, ownerRole })).toBe('link')
  })

  it('leaves a key that is already linked untouched', () => {
    expect(decideApiKeyBackfill({ ...linkable, alreadyLinked: true })).toBe('already-linked')
  })

  it('skips a key without a usable organization id', () => {
    expect(decideApiKeyBackfill({ ...linkable, organizationId: null })).toBe('skipped-invalid')
  })

  it('skips a key whose organization does not exist', () => {
    expect(decideApiKeyBackfill({ ...linkable, organizationExists: false, ownerRole: null }))
      .toBe('skipped-unknown-org')
  })

  it.each([
    ['an ordinary member', 'member'],
    ['not a member', null],
    ['holding a role list', 'owner,admin'],
    ['holding a differently cased role', 'Owner']
  ])('skips a key whose owner is %s', (_label, ownerRole) => {
    expect(decideApiKeyBackfill({ ...linkable, ownerRole })).toBe('skipped-not-manager')
  })
})
