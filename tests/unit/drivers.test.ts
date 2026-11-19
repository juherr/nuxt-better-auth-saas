// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeConfig = vi.hoisted(() => ({
  preset: 'node-server',
  databaseUrl: 'postgres://u:p@db:5432/app',
  resendApiKey: '' as string | undefined
}))

vi.mock('~~/server/utils/runtimeConfig', () => ({ runtimeConfig }))

describe('the Resend client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('is absent, without failing the import, when no API key is configured', async () => {
    runtimeConfig.resendApiKey = ''

    const { getResendClient } = await import('~~/server/utils/drivers')

    expect(getResendClient()).toBeUndefined()
  })

  it('is created once when an API key is configured', async () => {
    runtimeConfig.resendApiKey = 're_canary_key'

    const { getResendClient } = await import('~~/server/utils/drivers')

    const client = getResendClient()
    expect(client).toBeDefined()
    expect(getResendClient()).toBe(client)
  })
})

describe('isDatabaseConfigured', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.HYPERDRIVE
    delete (globalThis as { HYPERDRIVE?: unknown }).HYPERDRIVE
  })

  it('is true when a database URL is configured', async () => {
    runtimeConfig.databaseUrl = 'postgres://u:p@db:5432/app'

    const { isDatabaseConfigured } = await import('~~/server/utils/drivers')

    expect(isDatabaseConfigured()).toBe(true)
  })

  it('is false when no database URL nor Hyperdrive binding is configured', async () => {
    runtimeConfig.databaseUrl = ''

    const { isDatabaseConfigured } = await import('~~/server/utils/drivers')

    expect(isDatabaseConfigured()).toBe(false)
  })

  it('is true when only a Hyperdrive binding is available', async () => {
    runtimeConfig.databaseUrl = ''
    ;(globalThis as { HYPERDRIVE?: unknown }).HYPERDRIVE = { connectionString: 'postgres://u:p@hyperdrive:5432/app' }

    const { isDatabaseConfigured } = await import('~~/server/utils/drivers')

    expect(isDatabaseConfigured()).toBe(true)
  })
})
