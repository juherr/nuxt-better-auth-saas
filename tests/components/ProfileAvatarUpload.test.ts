import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ProfilePage from '~/pages/[slug]/profile.vue'

// The public demo stores no file (the upload route answers 403), so the
// profile page offers no avatar upload there.

mockNuxtImport('useAuth', () => () => ({
  user: ref({ id: 'user-1', name: 'Ada', email: 'ada@example.test', image: null }),
  useActiveOrganization: () => ref(null),
  client: { listAccounts: vi.fn(async () => ({ data: [] })) },
  fetchSession: vi.fn()
}))

async function mount() {
  return mountSuspended(ProfilePage, { global: { stubs: { SettingsSessionsSection: true } } })
}

describe('profile avatar upload', () => {
  afterEach(() => {
    useRuntimeConfig().public.demoMode = false
  })

  it('offers an avatar upload outside the public demo', async () => {
    const page = await mount()

    expect(page.text()).toContain('Upload Photo')
    expect(page.find('input[type="file"]').exists()).toBe(true)
  })

  it('offers no avatar upload in the public demo', async () => {
    useRuntimeConfig().public.demoMode = true

    const page = await mount()

    expect(page.text()).not.toContain('Upload Photo')
    expect(page.find('input[type="file"]').exists()).toBe(false)
    expect(page.find('.group-hover\\:opacity-100').exists()).toBe(false)
  })
})
