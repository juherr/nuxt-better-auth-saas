import { describe, expect, it } from 'vitest'
import {
  ACME_DEMO_ORGANIZATION_ID,
  buildDemoSeed,
  DEMO_ADMIN_CREDENTIALS,
  DEMO_ADMIN_USER_ID,
  DEMO_AUDIT_LOG_WINDOW_DAYS,
  DEMO_PROTECTED_ORGANIZATION_IDS,
  DEMO_PROTECTED_USER_IDS,
  DEMO_USER_CREDENTIALS,
  DEMO_USER_ID
} from '~~/scripts/demo/seedData'

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DAY_MS = 24 * 60 * 60 * 1000

// Two clock positions: the nightly reset can run at any hour, so nothing
// may depend on the time of day of `now`.
const NOWS = [new Date('2026-11-19T00:30:00.000Z'), new Date('2026-11-19T23:30:00.000Z')]
const now = new Date('2026-11-19T03:00:00.000Z')
const seed = buildDemoSeed(now)

const userIds = new Set(seed.users.map(user => user.id))
const organizationIds = new Set(seed.organizations.map(organization => organization.id))

function findUser(id: string) {
  const user = seed.users.find(candidate => candidate.id === id)
  if (!user)
    throw new Error(`no seeded user ${id}`)
  return user
}

describe('demo seed data', () => {
  it('seeds both public accounts, extras, two organizations and pending invitations', () => {
    expect(seed.users.length).toBeGreaterThanOrEqual(6)
    expect(seed.users.length).toBeLessThanOrEqual(8)
    expect(seed.organizations).toHaveLength(2)
    expect(seed.invitations).toHaveLength(2)
    expect(seed.auditLogs.length).toBeGreaterThan(0)
  })

  it('gives every row an id shaped like a uuidv7', () => {
    const ids = [
      ...seed.users.map(row => row.id),
      ...seed.accounts.map(row => row.id),
      ...seed.organizations.map(row => row.id),
      ...seed.members.map(row => row.id),
      ...seed.invitations.map(row => row.id)
    ]
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids)
      expect(id).toMatch(UUID_V7)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the same ids from one run to the next', () => {
    const other = buildDemoSeed(new Date('2027-01-01T12:00:00.000Z'))
    expect(other.users.map(user => user.id)).toEqual(seed.users.map(user => user.id))
    expect(other.organizations.map(org => org.id)).toEqual(seed.organizations.map(org => org.id))
  })

  it('uses unique lowercase emails and unique organization slugs', () => {
    const emails = seed.users.map(user => user.email)
    expect(new Set(emails).size).toBe(emails.length)
    for (const email of emails)
      expect(email).toBe(email.toLowerCase())
    const slugs = seed.organizations.map(org => org.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('points every account, member, invitation and audit log at a seeded user or organization', () => {
    for (const account of seed.accounts) {
      expect(userIds).toContain(account.userId)
      expect(account.accountId).toBe(account.userId)
      expect(account.providerId).toBe('credential')
    }
    for (const member of seed.members) {
      expect(userIds).toContain(member.userId)
      expect(organizationIds).toContain(member.organizationId)
    }
    for (const invitation of seed.invitations) {
      expect(organizationIds).toContain(invitation.organizationId)
      expect(userIds).toContain(invitation.inviterId)
    }
    for (const log of seed.auditLogs) {
      if (log.userId !== null)
        expect(userIds).toContain(log.userId)
    }
    for (const user of seed.users) {
      if (user.lastActiveOrganizationId === null)
        continue
      const membership = seed.members.find(member =>
        member.userId === user.id && member.organizationId === user.lastActiveOrganizationId)
      expect(membership, `${user.email} last active organization`).toBeDefined()
    }
  })

  it('gives every user one credential account', () => {
    expect(seed.accounts.map(account => account.userId).sort()).toEqual([...userIds].sort())
  })

  it('invites only emails that are not already members of the organization', () => {
    for (const invitation of seed.invitations) {
      const memberEmails = seed.members
        .filter(member => member.organizationId === invitation.organizationId)
        .map(member => findUser(member.userId).email)
      expect(memberEmails).not.toContain(invitation.email)
      expect(invitation.status).toBe('pending')
    }
  })

  it('lists the protected ids among the seeded rows', () => {
    expect(DEMO_PROTECTED_USER_IDS).toEqual(expect.arrayContaining([DEMO_USER_ID, DEMO_ADMIN_USER_ID]))
    expect(DEMO_PROTECTED_USER_IDS).toHaveLength(2)
    for (const id of DEMO_PROTECTED_USER_IDS)
      expect(userIds).toContain(id)
    expect([...DEMO_PROTECTED_ORGANIZATION_IDS].sort()).toEqual([...organizationIds].sort())
  })

  it('verifies both public accounts and logs them in with the published credentials', () => {
    const demo = findUser(DEMO_USER_ID)
    const admin = findUser(DEMO_ADMIN_USER_ID)
    expect(demo).toMatchObject({ email: 'demo@example.com', emailVerified: true, role: 'user', banned: false })
    expect(admin).toMatchObject({ email: 'demo-admin@example.com', emailVerified: true, role: 'admin', banned: false })
    expect(DEMO_USER_CREDENTIALS).toEqual({ email: 'demo@example.com', password: 'demo-password' })
    expect(DEMO_ADMIN_CREDENTIALS).toEqual({ email: 'demo-admin@example.com', password: 'demo-admin-password' })
    const passwordOf = (userId: string) => seed.accounts.find(account => account.userId === userId)?.plainPassword
    expect(passwordOf(DEMO_USER_ID)).toBe(DEMO_USER_CREDENTIALS.password)
    expect(passwordOf(DEMO_ADMIN_USER_ID)).toBe(DEMO_ADMIN_CREDENTIALS.password)
  })

  it('makes the demo user the owner of Acme Demo and its active organization', () => {
    const acme = seed.organizations.find(org => org.id === ACME_DEMO_ORGANIZATION_ID)
    expect(acme?.name).toBe('Acme Demo')
    const owners = seed.members.filter(member => member.organizationId === ACME_DEMO_ORGANIZATION_ID && member.role === 'owner')
    expect(owners.map(member => member.userId)).toEqual([DEMO_USER_ID])
    expect(findUser(DEMO_USER_ID).lastActiveOrganizationId).toBe(ACME_DEMO_ORGANIZATION_ID)
  })

  it('covers the owner, admin and member roles, one banned and one unverified extra', () => {
    expect(new Set(seed.members.map(member => member.role))).toEqual(new Set(['owner', 'admin', 'member']))
    const banned = seed.users.filter(user => user.banned)
    expect(banned).toHaveLength(1)
    expect(banned[0]?.banReason).toBeTruthy()
    expect(DEMO_PROTECTED_USER_IDS).not.toContain(banned[0]?.id)
    const unverified = seed.users.filter(user => !user.emailVerified)
    expect(unverified).toHaveLength(1)
    expect(DEMO_PROTECTED_USER_IDS).not.toContain(unverified[0]?.id)
  })

  it.each(NOWS)('expires pending invitations after now (%s)', (at) => {
    for (const invitation of buildDemoSeed(at).invitations) {
      expect(invitation.expiresAt.getTime()).toBeGreaterThan(at.getTime())
      expect(invitation.createdAt.getTime()).toBeLessThanOrEqual(at.getTime())
    }
  })

  it.each(NOWS)('dates every audit log within the window before now (%s)', (at) => {
    const logs = buildDemoSeed(at).auditLogs
    expect(logs.length).toBeGreaterThan(0)
    const oldest = at.getTime() - DEMO_AUDIT_LOG_WINDOW_DAYS * DAY_MS
    for (const log of logs) {
      expect(log.createdAt.getTime()).toBeLessThanOrEqual(at.getTime())
      expect(log.createdAt.getTime()).toBeGreaterThanOrEqual(oldest)
    }
  })
})
