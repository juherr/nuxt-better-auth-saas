// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { AUDITED_SUCCESS_PATHS, resolveAuditTarget } from '~~/server/utils/authAudit'

describe('resolveAuditTarget', () => {
  it('targets the session user when the request has a session', () => {
    expect(resolveAuditTarget({ path: '/sign-in/email', hasSession: true, sessionUserId: 'user-1', email: 'a@example.com' }))
      .toEqual({ targetType: 'user', targetId: 'user-1' })
  })

  it.each(['/sign-in/email', '/sign-up/email'])('targets the email of an anonymous %s request', (path) => {
    expect(resolveAuditTarget({ path, hasSession: false, email: 'a@example.com' }))
      .toEqual({ targetType: 'email', targetId: 'a@example.com' })
  })

  it('targets the email of an anonymous password reset request', () => {
    expect(resolveAuditTarget({ path: '/request-password-reset', hasSession: false, email: 'a@example.com' }))
      .toEqual({ targetType: 'email', targetId: 'a@example.com' })
  })

  it('has no target for other anonymous requests', () => {
    expect(resolveAuditTarget({ path: '/get-session', hasSession: false }))
      .toEqual({ targetType: undefined, targetId: undefined })
  })
})

describe('the audited success paths', () => {
  it.each(['/sign-in/email', '/sign-up/email', '/request-password-reset', '/reset-password'])('logs a successful %s', (path) => {
    expect(AUDITED_SUCCESS_PATHS).toContain(path)
  })
})
