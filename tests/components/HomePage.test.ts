// SPDX-License-Identifier: MIT
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import HomePage from '~/pages/index.vue'

// The screenshot tabs must not flash on first open: every image is in the DOM
// from the start, fetched eagerly, with its size declared so the browser
// reserves its box before the file arrives.

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
mockNuxtImport('useAuth', () => () => ({ user: ref(null) }))

async function mountPage() {
  return mountSuspended(HomePage, {
    global: {
      stubs: {
        NuxtLayout: { template: '<div><slot /></div>' },
        SiteNavigation: true,
        UserNavigation: true
      }
    }
  })
}

describe('home page screenshots', () => {
  it('renders every tab image up front, eagerly loaded and sized', async () => {
    const wrapper = await mountPage()

    // Desktop tabs only; the mobile accordion repeats the same images.
    const images = wrapper.findAll('[role="tabpanel"] img')

    expect(images.map(image => image.attributes('src'))).toEqual([
      '/screenshots/dashboard.png',
      '/screenshots/users.webp',
      '/screenshots/subscription.png',
      '/screenshots/pricing.png',
      '/screenshots/signin.png'
    ])
    for (const image of images) {
      expect(image.attributes('loading')).toBeUndefined()
      expect(Number(image.attributes('width'))).toBeGreaterThan(0)
      expect(Number(image.attributes('height'))).toBeGreaterThan(0)
    }
  })

  it('renders every accordion image up front on small screens', async () => {
    const wrapper = await mountPage()

    expect(wrapper.findAll('[data-orientation="vertical"] img')).toHaveLength(5)
  })
})
