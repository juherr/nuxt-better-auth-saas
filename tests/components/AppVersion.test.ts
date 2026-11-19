import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import AppVersion from '~/components/AppVersion.vue'

describe('appVersion', () => {
  afterEach(() => {
    useRuntimeConfig().public.appVersion = ''
  })

  it('shows the version of the build', async () => {
    useRuntimeConfig().public.appVersion = 'dev-abc1234'

    const wrapper = await mountSuspended(AppVersion)

    expect(wrapper.text()).toBe('dev-abc1234')
  })

  it('renders nothing without a version', async () => {
    useRuntimeConfig().public.appVersion = ''

    const wrapper = await mountSuspended(AppVersion)

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('span').exists()).toBe(false)
  })
})
