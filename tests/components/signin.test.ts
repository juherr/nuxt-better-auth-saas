import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SignIn from '~/pages/signin/index.vue'

// better-auth answers a sign-in with an unverified email with a 403 whose
// code is `EMAIL_NOT_VERIFIED` (api/routes/sign-in.mjs). The page must open
// the verify-email modal on that code, and toast any other error.

const { signInEmail, toastAdd } = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  toastAdd: vi.fn()
}))

mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))
mockNuxtImport('useToast', () => () => ({ add: toastAdd }))
mockNuxtImport('useAuth', () => () => ({
  signIn: { email: signInEmail, social: vi.fn() },
  sendVerificationEmail: vi.fn()
}))

async function submit() {
  const wrapper = await mountSuspended(SignIn)
  await wrapper.find('input[type="email"]').setValue('jane@example.com')
  await wrapper.find('input[type="password"]').setValue('password123')
  await wrapper.find('form').trigger('submit')
  await vi.waitFor(() => expect(signInEmail).toHaveBeenCalled())
  return wrapper
}

describe('sign-in page', () => {
  afterEach(() => {
    signInEmail.mockReset()
    toastAdd.mockReset()
    document.body.replaceChildren()
  })

  it('opens the verify-email modal when the email is not verified', async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { code: 'EMAIL_NOT_VERIFIED', status: 403, message: 'Email not verified' }
    })

    await submit()

    await vi.waitFor(() => expect(document.body.textContent).toContain('signIn.emailNotVerifiedDesc'))
    expect(toastAdd).not.toHaveBeenCalled()
  })

  it('toasts any other sign-in error without opening the modal', async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, message: 'Invalid email or password' }
    })

    await submit()

    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith({ title: 'Invalid email or password', color: 'error' }))
    expect(document.body.textContent).not.toContain('signIn.emailNotVerifiedDesc')
  })
})
