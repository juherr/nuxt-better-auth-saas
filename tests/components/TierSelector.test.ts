// SPDX-License-Identifier: MIT
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import TierSelector from '~/components/billing/TierSelector.vue'

// Nuxt UI v4 has no `gray` colour: a button given one gets no colour class
// at all. The downgrade CTA must use a v4 alias.

describe('billing tier selector', () => {
  it('gives the downgrade button the neutral colour', async () => {
    const wrapper = await mountSuspended(TierSelector, {
      props: { currentTierKey: 'business', currentInterval: 'year' }
    })
    const downgrade = wrapper.findAllComponents({ name: 'UButton' })
      .find(b => b.text().includes('Downgrade'))

    expect(downgrade?.exists()).toBe(true)
    expect(downgrade?.props('color')).toBe('neutral')
  })
})
