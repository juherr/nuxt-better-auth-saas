import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { refineMatchesPassword, refinePasswordsMatch } from '~~/app/utils/passwordConfirmation'

// The signup page refines the whole form (refinePasswordsMatch) and the
// reset-password page refines its confirmation field against the
// password typed so far (refineMatchesPassword).

const MISMATCH = 'Passwords do not match'

const issues = (result: { success: boolean, error?: z.ZodError }) =>
  result.error?.issues.map(issue => ({ message: issue.message, path: issue.path }))

describe('refinePasswordsMatch', () => {
  const schema = refinePasswordsMatch(z.object({
    password: z.string().min(8),
    confirmPassword: z.string()
  }), MISMATCH)

  it('reports a mismatch on confirmPassword', () => {
    const result = schema.safeParse({ password: 'password-1', confirmPassword: 'password-2' })

    expect(issues(result)).toEqual([{ message: MISMATCH, path: ['confirmPassword'] }])
  })

  it('accepts matching passwords', () => {
    expect(schema.safeParse({ password: 'password-1', confirmPassword: 'password-1' }).success).toBe(true)
  })
})

describe('refineMatchesPassword', () => {
  const state = { password: undefined as string | undefined }
  const schema = z.object({
    password: z.string().min(8),
    confirmPassword: refineMatchesPassword(z.string().min(8), () => state.password, MISMATCH)
  })

  it('reports a mismatch on confirmPassword', () => {
    state.password = 'password-1'
    const result = schema.safeParse({ password: 'password-1', confirmPassword: 'password-2' })

    expect(issues(result)).toEqual([{ message: MISMATCH, path: ['confirmPassword'] }])
  })

  it('compares with the password read at parse time', () => {
    state.password = 'password-2'

    expect(schema.safeParse({ password: 'password-2', confirmPassword: 'password-2' }).success).toBe(true)
  })
})
