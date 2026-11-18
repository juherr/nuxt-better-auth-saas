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

  // Nuxt UI v4 styles a button only through compound variants keyed on a
  // known colour alias: a v2 name such as `red` renders it unstyled.
  it.each([
    ['owner', 'Delete Team'],
    ['member', 'Leave Team']
  ])('for the role %s, the %s button uses the v4 error colour', async (role, label) => {
    authState.role = role
    const wrapper = await mountSuspended(DangerZone)
    const button = wrapper.findAllComponents({ name: 'UButton' })
      .find(b => b.text().includes(label))

    expect(button?.props('color')).toBe('error')
    expect(button?.classes()).toContain('text-error')
  })
})
