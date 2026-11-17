import { expect, it, vi } from 'vitest'

const { config } = vi.hoisted(() => ({ config: vi.fn() }))

vi.mock('dotenv', () => ({ config }))

// Outside Nuxt (CLI scripts such as `auth:schema`), the module loads `.env`
// itself. dotenv logs an "injecting env" line by default since v17; keep the
// CLI output as quiet as it was with dotenv 16.
it('loads .env quietly when no Nuxt runtime config is available', async () => {
  await import('~~/server/utils/runtimeConfig')

  expect(config).toHaveBeenCalledWith({ quiet: true })
})
