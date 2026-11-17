import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth'

// Kept by hand: `pnpm auth:schema` omits this table because the app stores
// sessions in `secondaryStorage` (better-auth core `db/get-tables.mjs`, same
// rule in 1.4). `create-admin.ts` runs better-auth without secondary storage,
// so its sign-up still writes a session row here.
export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('active_organization_id'),
  impersonatedBy: text('impersonated_by')
})
