import {
  DEMO_PROTECTED_EMAILS,
  DEMO_PROTECTED_MEMBER_IDS,
  DEMO_PROTECTED_ORGANIZATION_IDS,
  DEMO_PROTECTED_USER_IDS
} from '~~/scripts/demo/seedData'

/**
 * What the public demo must keep intact: the seeded accounts (by id and by
 * sign-in email), the seeded organizations and the memberships of the
 * protected accounts in them (by member row id).
 */
export interface DemoProtection {
  userIds: readonly string[]
  emails: readonly string[]
  organizationIds: readonly string[]
  memberIds: readonly string[]
}

/** The caller's session, as far as the demo policy needs it. */
export interface DemoSession {
  userId: string
  activeOrganizationId?: string | null
}

/**
 * The request carries a session cookie, but the hook could not resolve the
 * session (getSessionFromCtx answers null on a failed lookup). The endpoint
 * may still resolve it afterwards, so the user may be a protected one.
 */
export const DEMO_SESSION_UNRESOLVED = 'unresolved'

/**
 * A better-auth request seen from a before hook: the endpoint path
 * (relative to the auth base path) and the raw body, before the endpoint
 * validates it.
 */
export interface DemoRequest {
  path: string
  body: unknown
  /** The resolved session, `DEMO_SESSION_UNRESOLVED`, or null without a session cookie. */
  session: DemoSession | typeof DEMO_SESSION_UNRESOLVED | null
  /**
   * The user owning the session that `demoSessionTokenToResolve` names,
   * as the caller looked it up; null or absent when there is none.
   */
  sessionOwnerId?: string | null
}

/** The error code of every demo refusal, as clients and the smoke test read it. */
export const DEMO_MODE_RESTRICTED = 'DEMO_MODE_RESTRICTED'

export const DEMO_PROTECTION: DemoProtection = Object.freeze({
  userIds: DEMO_PROTECTED_USER_IDS,
  emails: DEMO_PROTECTED_EMAILS,
  organizationIds: DEMO_PROTECTED_ORGANIZATION_IDS,
  memberIds: DEMO_PROTECTED_MEMBER_IDS
})

// Endpoints that act on the session user. better-auth 1.7.25 exposes no
// `/set-password`: `setPassword` is a server-only endpoint without a path.
const SELF_PATHS: readonly string[] = [
  '/change-password',
  '/change-email',
  '/delete-user',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/revoke-session',
  '/link-social',
  '/unlink-account'
]

// Admin endpoints that act on the user named by `body.userId`.
const ADMIN_TARGET_PATHS: readonly string[] = [
  '/admin/ban-user',
  '/admin/remove-user',
  '/admin/set-user-password',
  '/admin/set-role',
  '/admin/impersonate-user',
  '/admin/revoke-user-sessions',
  '/admin/update-user',
  '/admin/list-user-sessions',
  '/admin/unban-user'
]

// Admin endpoint that acts on the session named by `body.sessionToken`.
const ADMIN_REVOKE_SESSION_PATH = '/admin/revoke-user-session'

type Body = Record<string, unknown>

const asBody = (body: unknown): Body =>
  (body !== null && typeof body === 'object' ? body as Body : {})

/**
 * A body field as the endpoint reads it. The admin endpoints coerce ids
 * with `String()`, so an id wrapped in an array still names that user:
 * compare what the endpoint will see, not the raw value.
 */
const text = (value: unknown): string | undefined =>
  (value === undefined || value === null ? undefined : String(value))

// Whether a field sets a value: null and '' clear it (removing an avatar
// or a logo stays allowed), absent leaves it alone.
const setsValue = (value: unknown) => {
  const read = text(value)
  return read !== undefined && read !== ''
}

const normalizeEmail = (value: string) => value.trim().toLowerCase()

const isProtectedEmail = (value: string | undefined, protection: DemoProtection) =>
  value !== undefined && protection.emails.some(email => normalizeEmail(email) === normalizeEmail(value))

// better-auth tells an email from a member id by the `@`.
const isEmail = (value: string) => value.includes('@')

/**
 * Why the demo refuses this request, or null to let it through. Pure: the
 * caller passes the session (null when the path does not need one, see
 * `demoNeedsSession`, or when the request carries no session cookie) and
 * the protected set. An unresolved session fails closed: it is refused
 * wherever a protected session, or a seeded active organization, would be.
 */
export function demoBlockReason(request: DemoRequest, protection: DemoProtection): string | null {
  const { path, session: given } = request
  const body = asBody(request.body)
  const unresolved = given === DEMO_SESSION_UNRESOLVED
  const session = unresolved ? null : given
  const isProtectedUser = (userId: string | null | undefined) =>
    userId !== undefined && userId !== null && protection.userIds.includes(userId)
  const isSeededOrganization = (organizationId: string | undefined) =>
    organizationId !== undefined && protection.organizationIds.includes(organizationId)
  const sessionMayBeProtected = unresolved || (session !== null && isProtectedUser(session.userId))
  // Whether the target organization (the one the body names, else the
  // session's active one) may be seeded: it may when only an unresolved
  // session could name it.
  const mayBeSeededTarget = () => {
    const named = text(body.organizationId) || undefined
    if (named === undefined && unresolved) {
      return true
    }
    return isSeededOrganization(named ?? session?.activeOrganizationId ?? undefined)
  }

  if (path === '/sign-up/email') {
    return 'Sign-up is disabled in the demo.'
  }
  if (SELF_PATHS.includes(path) && sessionMayBeProtected) {
    return 'The demo accounts cannot change their credentials, sessions or linked accounts.'
  }
  if (path === '/update-user' && sessionMayBeProtected && text(body.email) !== undefined) {
    return 'The demo accounts cannot change their email.'
  }
  if (path === '/update-user' && sessionMayBeProtected && setsValue(body.image)) {
    return 'The demo accounts cannot change their avatar.'
  }
  // better-auth 1.7.25 reads the logo from `data.logo` and the target from
  // `organizationId`, else the session's active organization.
  if (path === '/organization/update' && setsValue(asBody(body.data).logo) && mayBeSeededTarget()) {
    return 'The demo organizations cannot change their logo.'
  }
  if (path === '/request-password-reset' && isProtectedEmail(text(body.email), protection)) {
    return 'The demo accounts cannot reset their password.'
  }
  if ((ADMIN_TARGET_PATHS.includes(path) && isProtectedUser(text(body.userId)))
    || (path === ADMIN_REVOKE_SESSION_PATH && isProtectedUser(request.sessionOwnerId))) {
    return 'The demo accounts cannot be changed by an administrator.'
  }
  if (path === '/organization/delete' && isSeededOrganization(text(body.organizationId))) {
    return 'The demo organizations cannot be deleted.'
  }
  if (path === '/organization/leave' && sessionMayBeProtected && isSeededOrganization(text(body.organizationId))) {
    return 'The demo accounts cannot leave the demo organizations.'
  }
  if (path === '/organization/remove-member') {
    const target = text(body.memberIdOrEmail)
    const isProtectedTarget = target !== undefined && (isEmail(target)
      ? isProtectedEmail(target, protection) && mayBeSeededTarget()
      : protection.memberIds.includes(target))
    if (isProtectedTarget) {
      return 'The demo accounts cannot be removed from the demo organizations.'
    }
  }
  if (path === '/organization/update-member-role') {
    const target = text(body.memberId)
    if (target !== undefined && protection.memberIds.includes(target)) {
      return 'The roles of the demo accounts cannot be changed.'
    }
  }
  return null
}

/**
 * The session token whose owner `demoBlockReason` needs for this request
 * (as `sessionOwnerId`), or undefined when it needs none. The endpoint
 * reads the token as a string, so only a string names a session.
 */
export function demoSessionTokenToResolve(path: string, body: unknown): string | undefined {
  if (path !== ADMIN_REVOKE_SESSION_PATH) {
    return undefined
  }
  const token = asBody(body).sessionToken
  return typeof token === 'string' && token !== '' ? token : undefined
}

/**
 * Whether `demoBlockReason` needs the caller's session for this request.
 * Resolving a session costs a store lookup: skip it everywhere else.
 */
export function demoNeedsSession(path: string, body: unknown): boolean {
  if (SELF_PATHS.includes(path) || path === '/update-user' || path === '/organization/leave') {
    return true
  }
  if (path === '/organization/remove-member') {
    const fields = asBody(body)
    const target = text(fields.memberIdOrEmail)
    return target !== undefined && isEmail(target) && !text(fields.organizationId)
  }
  if (path === '/organization/update') {
    return !text(asBody(body).organizationId)
  }
  return false
}
