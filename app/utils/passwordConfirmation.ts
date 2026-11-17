import type { z } from 'zod'

interface PasswordPair {
  password?: string
  confirmPassword?: string
}

/**
 * Rejects an object schema whose `confirmPassword` differs from its
 * `password`, reporting `error` on the `confirmPassword` field.
 */
export const refinePasswordsMatch = <T extends z.ZodType<PasswordPair>>(schema: T, error: string) =>
  schema.refine(data => data.password === data.confirmPassword, {
    error,
    path: ['confirmPassword']
  })

/**
 * Rejects a confirmation field that differs from the password returned by
 * `getPassword`, reporting `error` on that field.
 */
export const refineMatchesPassword = (schema: z.ZodString, getPassword: () => string | undefined, error: string) =>
  schema.refine(val => val === getPassword(), { error })
