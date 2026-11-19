// SPDX-License-Identifier: MIT
import { APIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'
import {
  createdApiKeyId,
  isApiKeyManagerRole,
  parseLegacyOrganizationId,
  parseRequestedOrganizationId
} from '~~/server/utils/apiKeyMetadata'

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

describe('parseRequestedOrganizationId', () => {
  it.each([
    ['an already parsed object', { organizationId: 'org-1' }, 'org-1'],
    ['a JSON object string', JSON.stringify({ organizationId: 'org-1' }), 'org-1'],
    ['a double-encoded JSON string', JSON.stringify(JSON.stringify({ organizationId: 'org-12' })), 'org-12']
  ])('reads the organization id from %s', (_label, metadata, expected) => {
    expect(parseRequestedOrganizationId(metadata)).toBe(expected)
  })

  it.each([
    ['a leading space', { organizationId: ' org-1' }],
    ['a trailing space', { organizationId: 'org-1 ' }],
    ['a trailing newline', { organizationId: 'org-1\n' }],
    ['surrounding spaces in a JSON string', JSON.stringify({ organizationId: ' org-1 ' })],
    ['an empty organizationId', { organizationId: '' }],
    ['a whitespace organizationId', { organizationId: '   ' }],
    ['a numeric organizationId', { organizationId: 1 }],
    ['no organizationId', { label: 'org-1' }],
    ['no metadata', undefined],
    ['a non-JSON string', 'not json']
  ])('refuses an organization id with %s, which would not match the stored metadata', (_label, metadata) => {
    expect(parseRequestedOrganizationId(metadata)).toBeNull()
  })
})

describe('isApiKeyManagerRole', () => {
  it.each([
    ['the role', 'owner'],
    ['the role', 'admin'],
    ['a role list holding', 'owner,admin'],
    ['a spaced role list holding', 'member, admin']
  ])('lets %s "%s" manage API keys', (_label, role) => {
    expect(isApiKeyManagerRole(role)).toBe(true)
  })

  it.each([
    ['an ordinary member', 'member'],
    ['no membership', null],
    ['no role', undefined],
    ['an empty role list', ',,'],
    ['a differently cased role', 'Admin'],
    ['a role list of differently cased roles', 'Owner,Admin']
  ])('refuses %s', (_label, role) => {
    expect(isApiKeyManagerRole(role)).toBe(false)
  })
})

describe('createdApiKeyId', () => {
  it('reads the id of a created key', () => {
    expect(createdApiKeyId({ id: 'key-1', key: 'plaintext', name: 'ci' })).toBe('key-1')
  })

  it('ignores an error answer, whatever it carries', () => {
    const error = Object.assign(new APIError('BAD_REQUEST'), { id: 'key-1' })
    expect(createdApiKeyId(error)).toBeNull()
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an object without id', { key: 'plaintext' }],
    ['a blank id', { id: '' }],
    ['a numeric id', { id: 1 }],
    ['a string', 'key-1']
  ])('ignores %s', (_label, returned) => {
    expect(createdApiKeyId(returned)).toBeNull()
  })
})
