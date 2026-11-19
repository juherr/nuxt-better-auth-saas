import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import FilePage from '~/pages/admin/file/index.vue'

// The public demo stores no file (the upload route answers 403), so the
// admin file manager offers no upload there.

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))

// Renders the layout's slots, so the page's #navRight actions show up.
const LayoutStub = defineComponent({
  setup: (_props, { slots }) => () => h('div', [slots.navRight?.(), slots.default?.()])
})

async function mount() {
  return mountSuspended(FilePage, {
    global: { stubs: { NuxtLayout: LayoutStub, AdminTable: true } }
  })
}

describe('admin file manager upload', () => {
  afterEach(() => {
    useRuntimeConfig().public.demoMode = false
  })

  it('offers an upload outside the public demo', async () => {
    const page = await mount()

    expect(page.text()).toContain('fileManager.upload')
  })

  it('offers no upload in the public demo', async () => {
    useRuntimeConfig().public.demoMode = true

    const page = await mount()

    expect(page.text()).not.toContain('fileManager.upload')
    expect(page.findComponent({ name: 'FileUploadModal' }).exists()).toBe(false)
  })
})
