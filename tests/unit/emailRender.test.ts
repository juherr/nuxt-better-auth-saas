// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest'
import { renderTeamInvite, renderVerifyEmail } from '~~/server/utils/email'

vi.mock('~~/server/utils/runtimeConfig', () => ({
  runtimeConfig: { public: { appName: 'Acme SaaS' } }
}))

describe('email rendering', () => {
  it('renders the verify email template to a full HTML document', async () => {
    const url = 'https://app.example.com/verify?token=abc123'

    const html = await renderVerifyEmail('Ada', url)

    expect(html.startsWith('<!DOCTYPE html')).toBe(true)
    expect(html).toContain('Verify your email address')
    expect(html).toContain('Ada')
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('Verify Email')
    expect(html).toContain('Acme SaaS')
  })

  it('renders the team invite template with the inviter and the team', async () => {
    const url = 'https://app.example.com/invite/xyz'

    const html = await renderTeamInvite('Grace', 'Platform', url)

    expect(html).toContain('Grace')
    expect(html).toContain('Platform')
    expect(html).toContain(`href="${url}"`)
  })
})
