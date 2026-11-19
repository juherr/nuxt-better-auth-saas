import { APIError, getSessionFromCtx } from 'better-auth/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACME_DEMO_ORGANIZATION_ID, DEMO_ADMIN_CREDENTIALS, DEMO_USER_ID } from '~~/scripts/demo/seedData'
import { nitroCreateError } from './support/nitroGlobals'

const runtimeConfig = vi.hoisted(() => ({
  preset: 'cloudflare-module',
  databaseUrl: 'postgres://u:p@db:5432/app',
  betterAuthSecret: 'secret',
  resendApiKey: '',
  stripeSecretKey: '',
  stripeWebhookSecret: '',
  public: {
    baseURL: 'https://saas.example.test',
    appName: 'Acme',
    appNotifyEmail: 'notify@example.test',
    appEnv: 'production',
    demoMode: false
  }
}))
const betterAuth = vi.hoisted(() => vi.fn((options: any) => ({ options, api: {} })))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))
vi.mock('better-auth', () => ({ betterAuth }))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }))
vi.mock('~~/server/utils/db', () => ({ getDB: vi.fn(() => ({})), useDB: vi.fn(async () => ({})) }))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))
vi.mock('~~/server/utils/email', () => ({}))
vi.mock('~~/server/utils/stripeEmails', () => ({}))
vi.mock('~~/server/utils/subscription-handlers', () => ({ removeExcessMembersOnExpiration: vi.fn() }))
// The before hook resolves the session itself; answer from the test context
// instead of calling the real session endpoint.
vi.mock('better-auth/api', async importOriginal => ({
  ...await importOriginal<typeof import('better-auth/api')>(),
  getSessionFromCtx: vi.fn(async (ctx: any) => ctx.context?.session ?? null)
}))

vi.stubGlobal('createError', nitroCreateError)

const demoSession = { user: { id: DEMO_USER_ID }, session: { id: 'session-1', activeOrganizationId: null } }

async function beforeHook() {
  const { createBetterAuth } = await import('~~/server/utils/auth')
  createBetterAuth()
  const options = betterAuth.mock.calls.at(-1)![0] as any
  return options.hooks.before as (ctx: unknown) => Promise<unknown>
}

async function userCreateHook() {
  const { createBetterAuth } = await import('~~/server/utils/auth')
  createBetterAuth()
  const options = betterAuth.mock.calls.at(-1)![0] as any
  return options.databaseHooks.user.create.before as (user: unknown, ctx: unknown) => Promise<unknown>
}

function request(path: string, body: unknown = {}, session: unknown = null) {
  return {
    path,
    body,
    headers: new Headers(),
    getHeader: () => undefined,
    context: { session }
  }
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the hook to throw')
}

describe('the demo mode before hook', () => {
  beforeEach(() => {
    vi.resetModules()
    betterAuth.mockClear()
    vi.mocked(getSessionFromCtx).mockClear()
    runtimeConfig.public.demoMode = false
  })

  describe('when the demo mode is on', () => {
    beforeEach(() => {
      runtimeConfig.public.demoMode = true
    })

    it('refuses sign-up with a 403 carrying DEMO_MODE_RESTRICTED', async () => {
      const hook = await beforeHook()

      const error = await rejection(hook(request('/sign-up/email', { email: 'new@example.com' })))

      expect(error).toBeInstanceOf(APIError)
      expect((error as APIError).status).toBe('FORBIDDEN')
      expect((error as APIError).statusCode).toBe(403)
      expect((error as APIError).body).toMatchObject({ code: 'DEMO_MODE_RESTRICTED' })
      expect((error as APIError).body?.message).toBeTruthy()
    })

    it('refuses a password change by the demo user, from the session it resolves', async () => {
      const hook = await beforeHook()

      const error = await rejection(hook(request('/change-password', {}, demoSession)))

      expect((error as APIError).body).toMatchObject({ code: 'DEMO_MODE_RESTRICTED' })
      expect(getSessionFromCtx).toHaveBeenCalledTimes(1)
    })

    it('refuses an admin action on the demo user without resolving the session', async () => {
      const hook = await beforeHook()

      const error = await rejection(hook(request('/admin/ban-user', { userId: DEMO_USER_ID }, demoSession)))

      expect((error as APIError).body).toMatchObject({ code: 'DEMO_MODE_RESTRICTED' })
      expect(getSessionFromCtx).not.toHaveBeenCalled()
    })

    it('refuses revoking a demo user session, from the owner of the token it looks up', async () => {
      const hook = await beforeHook()
      const demoStoredSession = { user: { id: DEMO_USER_ID }, session: { id: 'session-2', token: 'demo-token', userId: DEMO_USER_ID } }
      const findSession = vi.fn(async (token: string) => (token === 'demo-token' ? demoStoredSession : null))
      const ctx = { ...request('/admin/revoke-user-session', { sessionToken: 'demo-token' }), context: { session: null, internalAdapter: { findSession } } }

      const error = await rejection(hook(ctx))

      expect((error as APIError).body).toMatchObject({ code: 'DEMO_MODE_RESTRICTED' })
      expect(findSession).toHaveBeenCalledWith('demo-token')
    })

    it('lets revoking another session through', async () => {
      const hook = await beforeHook()
      const findSession = vi.fn(async () => null)
      const ctx = { ...request('/admin/revoke-user-session', { sessionToken: 'other-token' }), context: { session: null, internalAdapter: { findSession } } }

      await expect(hook(ctx)).resolves.toBeUndefined()
      expect(findSession).toHaveBeenCalledWith('other-token')
    })

    it('refuses removing a demo account by email from the seeded organization the session has active', async () => {
      const hook = await beforeHook()
      const memberSession = { user: { id: 'acme-member-id' }, session: { id: 'session-3', activeOrganizationId: ACME_DEMO_ORGANIZATION_ID } }

      const error = await rejection(hook(request('/organization/remove-member', { memberIdOrEmail: DEMO_ADMIN_CREDENTIALS.email }, memberSession)))

      expect((error as APIError).body).toMatchObject({ code: 'DEMO_MODE_RESTRICTED' })
      expect(getSessionFromCtx).toHaveBeenCalledTimes(1)
    })

    it('lets removing a demo account by email through when the active organization is not seeded', async () => {
      const hook = await beforeHook()
      const memberSession = { user: { id: 'acme-member-id' }, session: { id: 'session-3', activeOrganizationId: 'other-organization-id' } }

      await expect(hook(request('/organization/remove-member', { memberIdOrEmail: DEMO_ADMIN_CREDENTIALS.email }, memberSession))).resolves.toBeUndefined()
      expect(getSessionFromCtx).toHaveBeenCalledTimes(1)
    })

    it('lets a request the policy allows through without resolving the session', async () => {
      const hook = await beforeHook()

      await expect(hook(request('/sign-in/email', { email: 'demo@example.com' }))).resolves.toBeUndefined()
      expect(getSessionFromCtx).not.toHaveBeenCalled()
    })
  })

  describe('the user create hook', () => {
    const newUser = { email: 'new@example.com', name: 'New' }

    it('refuses every user creation with DEMO_MODE_RESTRICTED when the demo mode is on', async () => {
      runtimeConfig.public.demoMode = true
      const hook = await userCreateHook()

      const error = await rejection(hook(newUser, { path: '/admin/create-user' }))

      expect(error).toBeInstanceOf(APIError)
      expect((error as APIError).statusCode).toBe(403)
      expect((error as APIError).body).toMatchObject({ code: 'DEMO_MODE_RESTRICTED' })
    })

    it('passes the user through unchanged when the demo mode is off', async () => {
      const hook = await userCreateHook()

      await expect(hook(newUser, { path: '/admin/create-user' })).resolves.toBeUndefined()
    })
  })

  describe('when the demo mode is off', () => {
    it.each([
      ['/sign-up/email', { email: 'new@example.com' }],
      ['/change-password', {}],
      ['/admin/ban-user', { userId: DEMO_USER_ID }]
    ])('lets %s through without resolving the session', async (path, body) => {
      const hook = await beforeHook()

      await expect(hook(request(path, body, demoSession))).resolves.toBeUndefined()
      expect(getSessionFromCtx).not.toHaveBeenCalled()
    })
  })
})
