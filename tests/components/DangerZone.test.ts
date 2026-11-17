import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import DangerZone from '~/components/settings/DangerZone.vue'

// better-auth stores a member holding several roles as one comma-separated
// value (`owner,admin`). The danger zone must read that list: an owner who
// is also an admin can delete the organization and cannot leave it.

const { authState } = vi.hoisted(() => ({
  authState: { role: 'owner' as string }
}))

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
mockNuxtImport('useAuth', () => () => ({
  organization: {},
  fetchSession: async () => {},
  user: ref({ id: 'user-1' }),
  useActiveOrganization: () => ref({
    data: {
      id: 'org-1',
      name: 'Acme',
      members: [{ userId: 'user-1', role: authState.role }]
    }
  })
}))

describe('settings danger zone', () => {
  it.each([
    ['owner', true],
    ['owner,admin', true],
    ['admin, owner', true],
    ['admin,member', false],
    ['member', false]
  ])('for the role %s, the member is an owner: %s', async (role, owner) => {
    authState.role = role
    const wrapper = await mountSuspended(DangerZone)
    const text = wrapper.text()

    expect(text.includes('Delete Team')).toBe(owner)
    expect(text.includes('Leave Team')).toBe(!owner)
  })
})
