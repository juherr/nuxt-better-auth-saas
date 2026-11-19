// Deterministic data for the public demo, written by scripts/demo/seed.ts.
//
// This module has no imports on purpose: the demo-mode guards import the
// protected ids and the public credentials from server and app code that is
// bundled for Cloudflare Workers, so it must stay free of drivers and I/O.
//
// Ids are fixed (uuidv7-shaped) so that a session left in KV after the
// nightly reset still points at the same user. Every date derives from the
// `now` handed to buildDemoSeed, by subtraction only, so the reset can run
// at any hour without writing rows in the future.
//
// Field names match the Drizzle properties of server/db/schema/auth.ts and
// the audit_log table, so the seed script maps them straight through. The
// seed bypasses better-auth, so it sets what better-auth would have set:
// role 'user' (admin plugin default), banned false, and the
// lastActiveOrganizationId the session hook reads. referralCode stays null:
// only the OAuth callback sets it.

export type DemoUserRole = 'user' | 'admin'
export type DemoMemberRole = 'owner' | 'admin' | 'member'
export type DemoAuditStatus = 'success' | 'failure' | 'pending'

export interface DemoCredentials {
  readonly email: string
  readonly password: string
}

export interface DemoUserRow {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: DemoUserRole
  banned: boolean
  banReason: string | null
  banExpires: Date | null
  lastActiveOrganizationId: string | null
  referralCode: string | null
  createdAt: Date
  updatedAt: Date
}

export interface DemoAccountRow {
  id: string
  accountId: string
  providerId: 'credential'
  userId: string
  // Clear text: the seed script hashes it into account.password.
  plainPassword: string
  createdAt: Date
  updatedAt: Date
}

export interface DemoOrganizationRow {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: string | null
  referralCode: string | null
  createdAt: Date
}

export interface DemoMemberRow {
  id: string
  organizationId: string
  userId: string
  role: DemoMemberRole
  createdAt: Date
}

export interface DemoInvitationRow {
  id: string
  organizationId: string
  email: string
  role: DemoMemberRole
  status: 'pending'
  expiresAt: Date
  createdAt: Date
  inviterId: string
}

// No id: audit_log.id is a serial, left to its sequence.
export interface DemoAuditLogRow {
  userId: string | null
  category: 'auth' | 'email'
  action: string
  targetType: string | null
  targetId: string | null
  ipAddress: string
  userAgent: string
  status: DemoAuditStatus
  details: string | null
  createdAt: Date
}

export interface DemoSeed {
  users: DemoUserRow[]
  accounts: DemoAccountRow[]
  organizations: DemoOrganizationRow[]
  members: DemoMemberRow[]
  invitations: DemoInvitationRow[]
  auditLogs: DemoAuditLogRow[]
}

export const DEMO_USER_ID = '01934b00-0000-7000-8000-000000000001'
export const DEMO_ADMIN_USER_ID = '01934b00-0000-7000-8000-000000000002'
const ALICE_USER_ID = '01934b00-0000-7000-8000-000000000003'
const BOB_USER_ID = '01934b00-0000-7000-8000-000000000004'
const CAROL_USER_ID = '01934b00-0000-7000-8000-000000000005'
const DAVE_USER_ID = '01934b00-0000-7000-8000-000000000006'
const ERIN_USER_ID = '01934b00-0000-7000-8000-000000000007'

export const ACME_DEMO_ORGANIZATION_ID = '01934b00-0000-7000-8000-000000000101'
export const GLOBEX_LABS_ORGANIZATION_ID = '01934b00-0000-7000-8000-000000000102'

export const DEMO_USER_CREDENTIALS: DemoCredentials = Object.freeze({
  email: 'demo@example.com',
  password: 'demo-password'
})

export const DEMO_ADMIN_CREDENTIALS: DemoCredentials = Object.freeze({
  email: 'demo-admin@example.com',
  password: 'demo-admin-password'
})

// Accounts and organizations the demo mode must not let anyone delete,
// ban or alter.
export const DEMO_PROTECTED_USER_IDS: readonly string[] = Object.freeze([DEMO_USER_ID, DEMO_ADMIN_USER_ID])
export const DEMO_PROTECTED_ORGANIZATION_IDS: readonly string[] = Object.freeze([
  ACME_DEMO_ORGANIZATION_ID,
  GLOBEX_LABS_ORGANIZATION_ID
])

export const DEMO_AUDIT_LOG_WINDOW_DAYS = 30

// Shared by the extra accounts; nobody is meant to sign in with them.
const EXTRA_PASSWORD = 'demo-extra-password'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const INVITATION_LIFETIME_MS = 2 * DAY_MS

interface UserSpec {
  id: string
  name: string
  email: string
  password: string
  role: DemoUserRole
  emailVerified: boolean
  ban: string | null
  lastActiveOrganizationId: string | null
  ageDays: number
}

const USERS: readonly UserSpec[] = [
  { id: DEMO_USER_ID, name: 'Demo User', email: DEMO_USER_CREDENTIALS.email, password: DEMO_USER_CREDENTIALS.password, role: 'user', emailVerified: true, ban: null, lastActiveOrganizationId: ACME_DEMO_ORGANIZATION_ID, ageDays: 90 },
  { id: DEMO_ADMIN_USER_ID, name: 'Demo Admin', email: DEMO_ADMIN_CREDENTIALS.email, password: DEMO_ADMIN_CREDENTIALS.password, role: 'admin', emailVerified: true, ban: null, lastActiveOrganizationId: null, ageDays: 90 },
  { id: ALICE_USER_ID, name: 'Alice Martin', email: 'alice@example.com', password: EXTRA_PASSWORD, role: 'user', emailVerified: true, ban: null, lastActiveOrganizationId: ACME_DEMO_ORGANIZATION_ID, ageDays: 75 },
  { id: BOB_USER_ID, name: 'Bob Chen', email: 'bob@example.com', password: EXTRA_PASSWORD, role: 'user', emailVerified: true, ban: null, lastActiveOrganizationId: ACME_DEMO_ORGANIZATION_ID, ageDays: 40 },
  { id: CAROL_USER_ID, name: 'Carol Diaz', email: 'carol@example.com', password: EXTRA_PASSWORD, role: 'user', emailVerified: true, ban: null, lastActiveOrganizationId: GLOBEX_LABS_ORGANIZATION_ID, ageDays: 60 },
  { id: DAVE_USER_ID, name: 'Dave Okafor', email: 'dave@example.com', password: EXTRA_PASSWORD, role: 'user', emailVerified: true, ban: 'Repeated spam invitations (demo data)', lastActiveOrganizationId: GLOBEX_LABS_ORGANIZATION_ID, ageDays: 35 },
  { id: ERIN_USER_ID, name: 'Erin Novak', email: 'erin@example.com', password: EXTRA_PASSWORD, role: 'user', emailVerified: false, ban: null, lastActiveOrganizationId: null, ageDays: 3 }
]

const ORGANIZATIONS: readonly { id: string, name: string, slug: string, ageDays: number }[] = [
  { id: ACME_DEMO_ORGANIZATION_ID, name: 'Acme Demo', slug: 'acme-demo', ageDays: 90 },
  { id: GLOBEX_LABS_ORGANIZATION_ID, name: 'Globex Labs', slug: 'globex-labs', ageDays: 60 }
]

const MEMBERS: readonly { id: string, organizationId: string, userId: string, role: DemoMemberRole, ageDays: number }[] = [
  { id: '01934b00-0000-7000-8000-000000000201', organizationId: ACME_DEMO_ORGANIZATION_ID, userId: DEMO_USER_ID, role: 'owner', ageDays: 90 },
  { id: '01934b00-0000-7000-8000-000000000202', organizationId: ACME_DEMO_ORGANIZATION_ID, userId: ALICE_USER_ID, role: 'admin', ageDays: 75 },
  { id: '01934b00-0000-7000-8000-000000000203', organizationId: ACME_DEMO_ORGANIZATION_ID, userId: BOB_USER_ID, role: 'member', ageDays: 40 },
  { id: '01934b00-0000-7000-8000-000000000204', organizationId: GLOBEX_LABS_ORGANIZATION_ID, userId: CAROL_USER_ID, role: 'owner', ageDays: 60 },
  { id: '01934b00-0000-7000-8000-000000000205', organizationId: GLOBEX_LABS_ORGANIZATION_ID, userId: ALICE_USER_ID, role: 'member', ageDays: 50 },
  { id: '01934b00-0000-7000-8000-000000000206', organizationId: GLOBEX_LABS_ORGANIZATION_ID, userId: DAVE_USER_ID, role: 'member', ageDays: 35 }
]

const INVITATIONS: readonly { id: string, organizationId: string, email: string, role: DemoMemberRole, inviterId: string, ageHours: number }[] = [
  { id: '01934b00-0000-7000-8000-000000000401', organizationId: ACME_DEMO_ORGANIZATION_ID, email: 'frank@example.com', role: 'member', inviterId: DEMO_USER_ID, ageHours: 5 },
  { id: '01934b00-0000-7000-8000-000000000402', organizationId: GLOBEX_LABS_ORGANIZATION_ID, email: 'grace@example.com', role: 'admin', inviterId: CAROL_USER_ID, ageHours: 20 }
]

// Users who sign in during the audit window, in rotation.
const ACTIVE_USER_IDS: readonly string[] = [DEMO_USER_ID, ALICE_USER_ID, DEMO_ADMIN_USER_ID, BOB_USER_ID, CAROL_USER_ID]

const USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0'
]

function pick<T>(items: readonly T[], index: number, fallback: T): T {
  return items[index % items.length] ?? fallback
}

function emailOf(userId: string): string {
  return USERS.find(user => user.id === userId)?.email ?? ''
}

// Sign-ins, failed sign-ins, password resets and a sign-up spread over the
// window, as the better-auth hooks would have logged them.
function buildAuditLogs(now: Date): DemoAuditLogRow[] {
  const at = (daysAgo: number, minutesAgo: number) =>
    new Date(now.getTime() - daysAgo * DAY_MS - minutesAgo * MINUTE_MS)
  const client = (index: number) => ({
    ipAddress: `203.0.113.${10 + (index % 40)}`,
    userAgent: pick(USER_AGENTS, index, '')
  })
  const logs: DemoAuditLogRow[] = []

  for (let day = 0; day < DEMO_AUDIT_LOG_WINDOW_DAYS; day++) {
    const signIns = 1 + (day % 3)
    for (let n = 0; n < signIns; n++) {
      const userId = pick(ACTIVE_USER_IDS, day + n, DEMO_USER_ID)
      logs.push({
        userId,
        category: 'auth',
        action: '/sign-in/email',
        targetType: 'user',
        targetId: userId,
        ...client(day + n),
        status: 'success',
        details: null,
        createdAt: at(day, 30 + n * 180)
      })
    }
    if (day % 4 === 1) {
      const email = pick(ACTIVE_USER_IDS.map(emailOf), day, '')
      logs.push({
        userId: null,
        category: 'auth',
        action: '/sign-in/email',
        targetType: 'email',
        targetId: email,
        ...client(day + 7),
        status: 'failure',
        details: 'Invalid email or password',
        createdAt: at(day, 25)
      })
    }
    if (day % 9 === 4) {
      const userId = pick(ACTIVE_USER_IDS, day, DEMO_USER_ID)
      const email = emailOf(userId)
      logs.push(
        { userId: null, category: 'auth', action: '/request-password-reset', targetType: 'email', targetId: email, ...client(day), status: 'success', details: null, createdAt: at(day, 600) },
        { userId, category: 'email', action: 'reset_password', targetType: 'email', targetId: email, ...client(day), status: 'success', details: null, createdAt: at(day, 599) },
        { userId: null, category: 'auth', action: '/reset-password', targetType: null, targetId: null, ...client(day), status: 'success', details: null, createdAt: at(day, 590) }
      )
    }
  }

  // The banned user tries to come back.
  logs.push({ userId: null, category: 'auth', action: '/sign-in/email', targetType: 'email', targetId: emailOf(DAVE_USER_ID), ...client(3), status: 'failure', details: 'You have been banned from this application', createdAt: at(2, 120) })

  // The unverified user signs up; the verification email bounces once.
  const erin = emailOf(ERIN_USER_ID)
  logs.push(
    { userId: null, category: 'auth', action: '/sign-up/email', targetType: 'email', targetId: erin, ...client(5), status: 'success', details: null, createdAt: at(3, 0) },
    { userId: ERIN_USER_ID, category: 'email', action: 'verification', targetType: 'email', targetId: erin, ...client(5), status: 'failure', details: 'Mailbox unavailable', createdAt: at(2, 1439) }
  )

  return logs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

export function buildDemoSeed(now: Date): DemoSeed {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS)

  const users = USERS.map((spec): DemoUserRow => ({
    id: spec.id,
    name: spec.name,
    email: spec.email,
    emailVerified: spec.emailVerified,
    image: null,
    role: spec.role,
    banned: spec.ban !== null,
    banReason: spec.ban,
    // A past date would lift the ban on the next sign-in attempt.
    banExpires: null,
    lastActiveOrganizationId: spec.lastActiveOrganizationId,
    referralCode: null,
    createdAt: daysAgo(spec.ageDays),
    updatedAt: daysAgo(spec.ageDays)
  }))

  const accounts = USERS.map((spec, index): DemoAccountRow => ({
    id: `01934b00-0000-7000-8000-${String(301 + index).padStart(12, '0')}`,
    accountId: spec.id,
    providerId: 'credential',
    userId: spec.id,
    plainPassword: spec.password,
    createdAt: daysAgo(spec.ageDays),
    updatedAt: daysAgo(spec.ageDays)
  }))

  const organizations = ORGANIZATIONS.map((spec): DemoOrganizationRow => ({
    id: spec.id,
    name: spec.name,
    slug: spec.slug,
    logo: null,
    metadata: null,
    referralCode: null,
    createdAt: daysAgo(spec.ageDays)
  }))

  const members = MEMBERS.map((spec): DemoMemberRow => ({
    id: spec.id,
    organizationId: spec.organizationId,
    userId: spec.userId,
    role: spec.role,
    createdAt: daysAgo(spec.ageDays)
  }))

  const invitations = INVITATIONS.map((spec): DemoInvitationRow => {
    const createdAt = new Date(now.getTime() - spec.ageHours * HOUR_MS)
    return {
      id: spec.id,
      organizationId: spec.organizationId,
      email: spec.email,
      role: spec.role,
      status: 'pending',
      // Counted from now rather than from createdAt: the invitation stays
      // valid for a full day of demo whatever its displayed age.
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
      createdAt,
      inviterId: spec.inviterId
    }
  })

  return { users, accounts, organizations, members, invitations, auditLogs: buildAuditLogs(now) }
}
