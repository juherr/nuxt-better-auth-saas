// SPDX-License-Identifier: MIT
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ProfilePage from '~/pages/profile/index.vue'

// better-auth's listAccounts() returns each linked account with its
// `providerId` (better-auth dist/api/routes/account.d.mts:83): the profile
// page must read that field to show the GitHub account as linked.

const { listAccounts } = vi.hoisted(() => ({
  listAccounts: vi.fn(async () => ({ data: [{ id: 'account-1', providerId: 'github', accountId: '42' }] }))
}))

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
mockNuxtImport('useLocalePath', () => () => (path: string) => path)
mockNuxtImport('useAuth', () => () => ({
  user: ref({ id: 'user-1', name: 'Ada', email: 'ada@example.test' }),
  session: ref({ id: 'session-1' }),
  client: { listAccounts, linkSocial: vi.fn() }
}))

describe('profile connected accounts', () => {
  it('shows GitHub as linked when an account has the github provider', async () => {
    const wrapper = await mountSuspended(ProfilePage)

    expect(listAccounts).toHaveBeenCalled()
    expect(wrapper.text()).toContain('profile.linkedGithub')
    expect(wrapper.text()).not.toContain('profile.linkGithub')
  })
})
