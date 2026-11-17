// Audit log helpers for the better-auth hooks.after middleware.

// Paths whose request body carries the email the action targets.
const EMAIL_TARGET_PATHS = ['/sign-in/email', '/sign-up/email', 'forget-password']

// Paths logged on success; failures are logged for every path.
export const AUDITED_SUCCESS_PATHS = ['/sign-in/email', '/sign-up/email', '/forget-password', '/reset-password']

interface AuditRequest {
  path: string
  // True when the request has a session or created one.
  hasSession: boolean
  sessionUserId?: string
  email?: string
}

export const resolveAuditTarget = ({ path, hasSession, sessionUserId, email }: AuditRequest) => {
  if (hasSession) {
    return { targetType: 'user', targetId: sessionUserId }
  }
  if (EMAIL_TARGET_PATHS.includes(path)) {
    return { targetType: 'email', targetId: email || '' }
  }
  return { targetType: undefined, targetId: undefined }
}
