import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import SiteNavigation from '~/components/SiteNavigation.vue'

describe('siteNavigation', () => {
  afterEach(() => {
    useRuntimeConfig().public.appRepo = 'https://github.com/juherr/nuxt-saas-starter'
  })

  it('links the docs entry to the configured repository', async () => {
    useRuntimeConfig().public.appRepo = 'https://github.com/acme/saas'

    const wrapper = await mountSuspended(SiteNavigation, { props: { mode: 'desktop' } })

    expect(wrapper.find('a[target="_blank"]').attributes('href')).toBe('https://github.com/acme/saas')
  })
})
