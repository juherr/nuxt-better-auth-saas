import { beforeEach, describe, expect, it, vi } from 'vitest'

const drivers = vi.hoisted(() => ({ isDatabaseConfigured: vi.fn(() => true) }))
const db = vi.hoisted(() => ({ execute: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })) }))
const getDB = vi.hoisted(() => vi.fn(() => db))

vi.mock('~~/server/utils/drivers', () => drivers)
vi.mock('~~/server/utils/db', () => ({ getDB, useDB: vi.fn(async () => db) }))

// Nitro auto-imports, unavailable outside Nuxt.
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('setResponseStatus', (event: { status?: number }, code: number) => {
  event.status = code
})

const CANARY = 'connect ECONNREFUSED postgres://canary-user:canary-password@db-canary:5432/app'

const callHealth = async () => {
  const handler = (await import('~~/server/api/health.get')).default as unknown as
    (event: { status?: number }) => Promise<unknown>
  const event: { status?: number } = {}
  const body = await handler(event)
  return { status: event.status ?? 200, body }
}

describe('the health endpoint (GET /api/health)', () => {
  beforeEach(() => {
    drivers.isDatabaseConfigured.mockReturnValue(true)
    db.execute.mockClear()
    db.execute.mockResolvedValue({ rows: [{ '?column?': 1 }] })
    getDB.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('answers ok after querying the database when one is configured', async () => {
    const { status, body } = await callHealth()

    expect(status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('answers ok without touching the database when none is configured', async () => {
    drivers.isDatabaseConfigured.mockReturnValue(false)

    const { status, body } = await callHealth()

    expect(status).toBe(200)
    expect(body).toEqual({ status: 'ok' })
    expect(getDB).not.toHaveBeenCalled()
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('answers 503 with a generic body and logs the error when the database check fails', async () => {
    db.execute.mockRejectedValue(new Error(CANARY))

    const { status, body } = await callHealth()

    expect(status).toBe(503)
    expect(body).toEqual({ status: 'error' })
    expect(JSON.stringify(body)).not.toContain('canary')
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: CANARY }))
  })

  it('answers 503 when the database client cannot be created', async () => {
    getDB.mockImplementationOnce(() => {
      throw new Error(CANARY)
    })

    const { status, body } = await callHealth()

    expect(status).toBe(503)
    expect(body).toEqual({ status: 'error' })
  })
})
