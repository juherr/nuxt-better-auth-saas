import { getAuthTables } from 'better-auth/db'
import { organization as organizationPlugin } from 'better-auth/plugins'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '~~/server/db/schema'
import { organizationAdditionalFields } from '~~/server/utils/authSchemaFields'

// `pnpm auth:schema` rewrites server/db/schema/auth.ts from the auth config:
// a column the config does not declare disappears from the regenerated file.
describe('auth schema', () => {
  it('declares organization.referralCode in the organization plugin config', () => {
    const tables = getAuthTables({
      plugins: [organizationPlugin({ schema: { organization: { additionalFields: organizationAdditionalFields } } })]
    })
    expect(tables.organization?.fields).toHaveProperty('referralCode')
  })

  it('keeps organization.referralCode out of the client input', () => {
    expect(organizationAdditionalFields.referralCode.input).toBe(false)
  })

  it.each([
    ['user', 'lastActiveOrganizationId'],
    ['user', 'referralCode'],
    ['user', 'stripeCustomerId'],
    ['organization', 'referralCode'],
    ['organization', 'stripeCustomerId'],
    ['subscription', 'referenceId'],
    ['subscription', 'seats'],
    ['apiKey', 'referenceId'],
    ['apiKey', 'configId'],
    ['rateLimit', 'key'],
    ['rateLimit', 'count'],
    ['rateLimit', 'lastRequest'],
    // Hand-kept in session.ts: the generator omits it, create-admin.ts writes it.
    ['session', 'token']
  ] as const)('keeps %s.%s in the generated drizzle schema', (table, column) => {
    const columns = getTableColumns((schema as Record<string, any>)[table])
    expect(columns).toHaveProperty(column)
  })
})
