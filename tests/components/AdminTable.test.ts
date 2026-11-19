// SPDX-License-Identifier: MIT
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import AdminTable from '~/components/AdminTable/index.vue'

// Nuxt UI v4 takes each `ui` slot as a class string. A v2 object such as
// `th: { padding: 'py-2' }` is not a class string: the cell kept the
// theme's default padding.

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))

describe('admin table', () => {
  it('applies the compact vertical padding to header and body cells', async () => {
    const wrapper = await mountSuspended(AdminTable, {
      props: {
        columns: [{ accessorKey: 'name', header: 'Name' }],
        fetchData: async () => ({ data: [{ name: 'Acme' }], total: 1 }),
        hidePagination: true
      }
    })

    const th = wrapper.find('th')
    expect(th.exists()).toBe(true)
    expect(th.classes()).toContain('py-2')

    // The table fetches its rows through a 1 s debounce.
    await vi.waitFor(() => expect(wrapper.text()).toContain('Acme'), { timeout: 3000 })
    const td = wrapper.find('td')
    expect(td.classes()).toContain('py-2')
  })
})
