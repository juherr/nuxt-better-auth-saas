import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildInvitationUrl } from '~~/shared/utils/invitationUrl'

describe('buildInvitationUrl', () => {
  // i18n uses prefix_except_default, so the unprefixed path is the route of
  // the default locale.
  it('points at the accept-invite page', () => {
    expect(buildInvitationUrl('https://saas.example.test', 'inv-1'))
      .toBe('https://saas.example.test/accept-invite/inv-1')
  })

  it('serves that path from an existing page file', () => {
    const page = fileURLToPath(new URL('../../app/pages/accept-invite/[id].vue', import.meta.url))

    expect(existsSync(page)).toBe(true)
  })

  it('does not double the slash of a base URL ending with one', () => {
    expect(buildInvitationUrl('https://saas.example.test/', 'inv-1'))
      .toBe('https://saas.example.test/accept-invite/inv-1')
  })
})
