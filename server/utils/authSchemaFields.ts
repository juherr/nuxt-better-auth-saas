import type { DBFieldAttribute } from 'better-auth/db'

/**
 * Columns the app adds to the organization plugin's `organization` table.
 * Declared here so that `pnpm auth:schema` keeps them in the generated schema.
 * `input: false` keeps them out of the create/update organization bodies.
 */
export const organizationAdditionalFields = {
  referralCode: {
    type: 'string',
    required: false,
    input: false
  }
} satisfies Record<string, DBFieldAttribute>
