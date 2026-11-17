import type { Table } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { getTableName } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderSql } from './support/sql'

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
    appEnv: 'production'
  }
}))
const betterAuth = vi.hoisted(() => vi.fn((options: any) => ({ options, api: {} })))
const insertValues = vi.hoisted(() => vi.fn(async (_row: unknown) => undefined))
const insert = vi.hoisted(() => vi.fn((_table: unknown) => ({ values: insertValues })))
const deleteWhere = vi.hoisted(() => vi.fn(async (_where: unknown) => undefined))
const deleteFrom = vi.hoisted(() => vi.fn((_table: unknown) => ({ where: deleteWhere })))
const logAuditEvent = vi.hoisted(() => vi.fn())

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))
vi.mock('better-auth', () => ({ betterAuth }))
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: vi.fn(() => ({})) }))
vi.mock('~~/server/utils/db', () => ({ getDB: vi.fn(() => ({ insert, delete: deleteFrom })), useDB: vi.fn(async () => ({})) }))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent }))
vi.mock('~~/server/utils/email', () => ({}))
vi.mock('~~/server/utils/stripeEmails', () => ({}))
vi.mock('~~/server/utils/subscription-handlers', () => ({ removeExcessMembersOnExpiration: vi.fn() }))
// The before hook resolves the session itself; answer from the test context
// instead of calling the real session endpoint.
vi.mock('better-auth/api', async importOriginal => ({
  ...await importOriginal<typeof import('better-auth/api')>(),
  getSessionFromCtx: vi.fn(async (ctx: any) => ctx.context?.session ?? null)
}))

vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input))

const PLAINTEXT_KEY = 'canary-plaintext-key'
const session = { user: { id: 'user-1' }, session: { id: 'session-1' } }

async function authOptions() {
  const { createBetterAuth } = await import('~~/server/utils/auth')
  createBetterAuth()
  return betterAuth.mock.calls.at(-1)![0] as any
}

function createRequest(options: {
  metadata?: unknown
  role?: string | null
  withSession?: boolean
  returned?: unknown
}) {
  const role = options.role === undefined ? 'owner' : options.role
  const findOne = vi.fn(async () => (role === null ? null : { role }))
  return {
    findOne,
    ctx: {
      path: '/api-key/create',
      body: { name: 'ci', metadata: options.metadata },
      headers: new Headers(),
      getHeader: () => undefined,
      context: {
        session: options.withSession === false ? null : session,
        adapter: { findOne },
        returned: options.returned
      }
    }
  }
}

describe('creating an API key', () => {
  let spies: ReturnType<typeof vi.spyOn>[]

  beforeEach(() => {
    vi.resetModules()
    betterAuth.mockClear()
    insert.mockClear()
    insertValues.mockReset().mockResolvedValue(undefined)
    logAuditEvent.mockClear()
    spies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map(level => vi.spyOn(console, level).mockImplementation(() => {}))
  })

  afterEach(() => {
    spies.forEach(spy => spy.mockRestore())
  })

  const loggedText = () => JSON.stringify([
    ...spies.flatMap(spy => spy.mock.calls.flat()).map(arg => (arg instanceof Error ? arg.stack : arg)),
    ...logAuditEvent.mock.calls
  ])

  describe('before the key is created', () => {
    it.each(['owner', 'admin'])('lets the organization %s create a key for it', async (role) => {
      const options = await authOptions()
      const { ctx } = createRequest({ metadata: { organizationId: 'org-1' }, role })

      await expect(options.hooks.before(ctx)).resolves.toBeUndefined()
    })

    it('checks the membership of the exact organization the metadata names', async () => {
      const options = await authOptions()
      const { ctx, findOne } = createRequest({ metadata: { organizationId: 'org-1' } })

      await options.hooks.before(ctx)

      expect(findOne).toHaveBeenCalledWith({
        model: 'member',
        where: [
          { field: 'organizationId', value: 'org-1' },
          { field: 'userId', value: 'user-1' }
        ]
      })
    })

    it('reads the organization from double-encoded metadata the same way as the backfill', async () => {
      const options = await authOptions()
      const metadata = JSON.stringify(JSON.stringify({ organizationId: 'org-12' }))
      const { ctx, findOne } = createRequest({ metadata })

      await options.hooks.before(ctx)

      expect(findOne).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.arrayContaining([{ field: 'organizationId', value: 'org-12' }])
      }))
    })

    it('refuses an anonymous caller with 401 before any lookup', async () => {
      const options = await authOptions()
      const { ctx, findOne } = createRequest({ metadata: { organizationId: 'org-1' }, withSession: false })

      await expect(options.hooks.before(ctx)).rejects.toMatchObject({ statusCode: 401 })
      expect(findOne).not.toHaveBeenCalled()
    })

    it('refuses an ordinary member, a non-member and a key without organization with the same 403', async () => {
      const options = await authOptions()
      const refusals = await Promise.all([
        createRequest({ metadata: { organizationId: 'org-1' }, role: 'member' }),
        createRequest({ metadata: { organizationId: 'org-1' }, role: null }),
        createRequest({ metadata: { organizationId: 'org-1' }, role: 'owner,admin' }),
        createRequest({ metadata: undefined }),
        createRequest({ metadata: { organizationId: '  ' } }),
        createRequest({ metadata: { organizationId: ' org-1' } }),
        createRequest({ metadata: { organizationId: 'org-1 ' } }),
        createRequest({ metadata: { label: 'org-1' } })
      ].map(({ ctx }) => options.hooks.before(ctx).catch((e: unknown) => e)))

      for (const refusal of refusals) {
        expect(refusal).toBeInstanceOf(APIError)
        expect(refusal).toMatchObject({ statusCode: 403, message: (refusals[0] as APIError).message })
      }
    })
  })

  describe('after the key is created', () => {
    const created = { id: 'key-1', key: PLAINTEXT_KEY, name: 'ci', metadata: { organizationId: 'org-1' } }

    it('links the created key to the organization it was created for', async () => {
      const options = await authOptions()
      const { ctx } = createRequest({ metadata: { organizationId: 'org-1' }, returned: created })

      await options.hooks.after(ctx)

      expect(insert).toHaveBeenCalledTimes(1)
      expect(insertValues).toHaveBeenCalledWith({ apiKeyId: 'key-1', organizationId: 'org-1' })
    })

    it('links nothing when the organization id in the metadata is not exact', async () => {
      const options = await authOptions()
      const { ctx } = createRequest({ metadata: { organizationId: ' org-1 ' }, returned: created })

      await options.hooks.after(ctx)

      expect(insert).not.toHaveBeenCalled()
    })

    it('links nothing when the creation failed', async () => {
      const options = await authOptions()
      const { ctx } = createRequest({ metadata: { organizationId: 'org-1' }, returned: new APIError('BAD_REQUEST') })

      await options.hooks.after(ctx)

      expect(insert).not.toHaveBeenCalled()
    })

    it('links nothing on other endpoints', async () => {
      const options = await authOptions()
      const { ctx } = createRequest({ metadata: { organizationId: 'org-1' }, returned: created })

      await options.hooks.after({ ...ctx, path: '/api-key/verify' })

      expect(insert).not.toHaveBeenCalled()
    })

    it('replaces the answer with an error when the link cannot be written, so no one holds an unlisted key', async () => {
      insertValues.mockRejectedValue(new Error('insert failed'))
      const options = await authOptions()
      const { ctx } = createRequest({ metadata: { organizationId: 'org-1' }, returned: created })

      const error = await options.hooks.after(ctx).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(APIError)
      expect(error).toMatchObject({ statusCode: 500 })
      expect(JSON.stringify((error as APIError).body)).not.toContain(PLAINTEXT_KEY)
    })

    it('never logs the plaintext key, whether the link succeeds or fails', async () => {
      const options = await authOptions()
      await options.hooks.after(createRequest({ metadata: { organizationId: 'org-1' }, returned: created }).ctx)
      insertValues.mockRejectedValue(new Error('insert failed'))
      await options.hooks.after(createRequest({ metadata: { organizationId: 'org-1' }, returned: created }).ctx).catch(() => {})

      expect(loggedText()).not.toContain(PLAINTEXT_KEY)
    })
  })

  describe('the API key plugin endpoints the app does not use', () => {
    const unused = ['/api-key/get', '/api-key/list', '/api-key/update', '/api-key/delete']

    it('are disabled, while creation and server-side verification stay available', async () => {
      const options = await authOptions()

      expect(options.disabledPaths).toEqual(expect.arrayContaining(unused))
      expect(options.disabledPaths).not.toContain('/api-key/create')
      expect(options.disabledPaths).not.toContain('/api-key/verify')
    })

    it.each(unused)('refuses %s by its resolved path', async (path) => {
      const options = await authOptions()

      await expect(options.hooks.before({ path })).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('deleting an organization', () => {
    it('deletes the organization\'s API keys before the organization goes', async () => {
      deleteFrom.mockClear()
      deleteWhere.mockClear()
      const options = await authOptions()
      const organizationPlugin = options.plugins.find((plugin: { id: string }) => plugin.id === 'organization')

      await organizationPlugin.options.organizationHooks.beforeDeleteOrganization({
        organization: { id: 'org-1' },
        user: session.user
      })

      // Modules are reset between tests, so compare the table by its name.
      expect(deleteFrom).toHaveBeenCalledTimes(1)
      expect(getTableName(deleteFrom.mock.calls[0]![0] as Table)).toBe('apiKey')
      expect(renderSql(deleteWhere.mock.calls[0]![0]).params).toEqual(['org-1'])
    })
  })
})
