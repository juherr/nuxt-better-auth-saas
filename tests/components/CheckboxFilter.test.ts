// SPDX-License-Identifier: MIT
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import CheckboxFilter from '~/components/AdminTable/components/filters/Checkbox/index.vue'

// Without a bound v-model the filter falls back to its default. A literal
// `[]` default is one array shared by every instance, and the filter pushes
// into it in place, so checking an option in one filter leaked into the
// others. A factory default gives each instance its own array.

const items = [
  { id: 'active', label: 'Active' },
  { id: 'banned', label: 'Banned' }
]

// The component's <i18n> block needs vue-i18n installed on the app that
// mountSuspended creates; translations play no part in this test.
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))

interface CheckboxFilterVm {
  filter: string[]
  onUpdateChecked: (checked: boolean, item: { id: string, label: string }) => void
}

describe('adminTable checkbox filter', () => {
  it('keeps its own default selection per instance', async () => {
    const first = await mountSuspended(CheckboxFilter, {
      props: { items, name: 'Status', filterName: 'status' }
    })
    const second = await mountSuspended(CheckboxFilter, {
      props: { items, name: 'Role', filterName: 'role' }
    })

    const firstVm = first.vm as unknown as CheckboxFilterVm
    const secondVm = second.vm as unknown as CheckboxFilterVm

    firstVm.onUpdateChecked(true, items[0]!)

    expect(firstVm.filter).toEqual(['active'])
    expect(secondVm.filter).toEqual([])
  })
})
