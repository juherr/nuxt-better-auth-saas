import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

const db = vi.hoisted(() => {
  const where = vi.fn(async () => [])
  return { where, delete: vi.fn(() => ({ where })) }
})

vi.mock('better-auth', async importOriginal => ({
  ...await importOriginal<typeof import('better-auth')>(),
  // Hand back the options instead of building an auth instance.
  betterAuth: (options: unknown) => options
}))
vi.mock('~~/server/utils/runtimeConfig', () => ({
  runtimeConfig: { public: { baseURL: 'https://saas.example.test' } }
}))
vi.mock('~~/server/utils/db', () => ({ getDB: () => db }))
vi.mock('~~/server/utils/drivers', () => ({ cacheClient: {}, getResendClient: () => undefined }))
vi.mock('~~/server/utils/auditLogger', () => ({ logAuditEvent: vi.fn() }))
vi.mock('~~/server/utils/emails', () => ({}))

const { createBetterAuth } = await import('~~/server/utils/auth')
const options = createBetterAuth() as any

describe('the user delete hook', () => {
  beforeEach(() => {
    db.delete.mockClear()
    db.where.mockClear()
  })

  // api_key.reference_id has no foreign key to user since better-auth 1.5,
  // so nothing in the database removes the keys of a deleted user.
  it('deletes the API keys the deleted user owns', async () => {
    await options.databaseHooks.user.delete?.after?.({ id: 'user-1' })

    expect(db.delete).toHaveBeenCalledWith(schema.apiKey)
    expect(db.where).toHaveBeenCalledTimes(1)
    const [[where]] = db.where.mock.calls as unknown as [[SQL]]
    const condition = new PgDialect().sqlToQuery(where)
    expect(condition).toMatchObject({ sql: '"api_key"."reference_id" = $1', params: ['user-1'] })
  })
})
