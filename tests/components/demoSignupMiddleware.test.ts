// SPDX-License-Identifier: MIT
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import demoSignup from '~/middleware/demo-signup'

// The public demo creates no account (better-auth refuses it server-side),
// so the sign-up page sends its visitors to the sign-in page.

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))

mockNuxtImport('navigateTo', () => navigateToMock)

async function run(query: Record<string, string> = {}) {
  const resolved = useRouter().resolve({ path: '/signup', query })
  const to = { ...resolved, name: resolved.name ?? undefined }
  return demoSignup(to, to)
}

describe('the demo sign-up middleware', () => {
  afterEach(() => {
    useRuntimeConfig().public.demoMode = false
    navigateToMock.mockReset()
  })

  it('is attached to the sign-up page', () => {
    expect(useRouter().resolve('/signup').meta.middleware).toContain('demo-signup')
  })

  it('lets the sign-up page open outside the public demo', async () => {
    await run()

    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('redirects to the localized sign-in page in the public demo, keeping the query', async () => {
    useRuntimeConfig().public.demoMode = true
    const query = { redirect: '/accept-invite/abc' }

    await run(query)

    expect(navigateToMock).toHaveBeenCalledWith(useLocalePath()({ path: '/signin', query }))
  })
})
