import { describe, expect, it } from 'vitest'
import {
  decideApiKeyBackfill,
  describeUnlinkedApiKeys,
  parseApiKeyBackfillArgs
} from '~~/server/utils/apiKeyBackfill'

describe('decideApiKeyBackfill', () => {
  const linkable = {
    alreadyLinked: false,
    organizationId: 'org-1',
    organizationExists: true,
    ownerRole: 'owner'
  }

  it.each(['owner', 'admin', 'owner,admin', 'member, admin'])('links a key whose owner holds "%s" in the organization', (ownerRole) => {
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
    ['holding a differently cased role', 'Owner'],
    ['holding a role list of differently cased roles', 'Owner,Admin']
  ])('skips a key whose owner is %s', (_label, ownerRole) => {
    expect(decideApiKeyBackfill({ ...linkable, ownerRole })).toBe('skipped-not-manager')
  })
})

describe('parseApiKeyBackfillArgs', () => {
  it('only reports unlinked keys by default', () => {
    expect(parseApiKeyBackfillArgs([])).toEqual({ disableUnlinked: false })
  })

  it('disables unlinked keys when asked to', () => {
    expect(parseApiKeyBackfillArgs(['--disable-unlinked'])).toEqual({ disableUnlinked: true })
  })

  it.each([
    ['a misspelled flag', '--disable-unlink'],
    ['a flag with a value', '--disable-unlinked=true'],
    ['another argument', '--dry-run']
  ])('refuses %s instead of running without it', (_label, arg) => {
    expect(parseApiKeyBackfillArgs([arg])).toEqual({ error: `Unknown argument: ${arg}` })
  })
})

describe('describeUnlinkedApiKeys', () => {
  it('reports how many unlinked keys were disabled', () => {
    expect(describeUnlinkedApiKeys({ disableUnlinked: true, disabledCount: 3 }))
      .toBe('disabled-unlinked=3')
  })

  it('lists the ids of the unlinked keys that remain enabled', () => {
    expect(describeUnlinkedApiKeys({ disableUnlinked: false, enabledUnlinkedIds: ['key-1', 'key-2'] }))
      .toBe('enabled-unlinked=2 ids=key-1,key-2 (rerun with --disable-unlinked to disable them)')
  })

  it('reports that no unlinked key remains enabled', () => {
    expect(describeUnlinkedApiKeys({ disableUnlinked: false, enabledUnlinkedIds: [] }))
      .toBe('enabled-unlinked=0')
  })
})
