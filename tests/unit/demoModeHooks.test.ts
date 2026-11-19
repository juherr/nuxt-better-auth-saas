import { APIError, getSessionFromCtx } from 'better-auth/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_USER_ID } from '~~/scripts/demo/seedData'
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

    it('lets a request the policy allows through without resolving the session', async () => {
      const hook = await beforeHook()

      await expect(hook(request('/sign-in/email', { email: 'demo@example.com' }))).resolves.toBeUndefined()
      expect(getSessionFromCtx).not.toHaveBeenCalled()
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
