// Writes the demo data of scripts/demo/seedData.ts into DATABASE_URL.
//
// Run with plain Node 26 (type stripping): relative imports carry their
// `.ts` extension and Nuxt aliases are not available. Expects an empty,
// migrated schema (the reset script drops and migrates first): on a
// database that already holds the demo rows, the inserts fail on their
// primary or unique keys and the transaction rolls back.
import process from 'node:process'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { account, invitation, member, organization, user } from '../../server/db/schema/auth.ts'
import { buildDemoSeed } from './seedData.ts'
import 'dotenv/config'

// server/db/schema/auditLog.ts imports './auth' without extension, which
// Node cannot resolve. `id` is left out on purpose: it is a serial, and an
// explicit value would not advance its sequence.
const auditLog = pgTable('audit_log', {
  userId: text('user_id'),
  category: text('category').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  status: text('status').notNull(),
  details: text('details'),
  createdAt: timestamp('created_at').notNull()
})

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is not set: point it at the migrated, empty Postgres database to seed.')
    return 1
  }

  const seed = buildDemoSeed(new Date())
  const accounts = await Promise.all(seed.accounts.map(async ({ plainPassword, ...row }) => ({
    ...row,
    password: await hashPassword(plainPassword)
  })))

  const pool = new pg.Pool({ connectionString })
  try {
    const db = drizzle(pool)
    await db.transaction(async (tx) => {
      await tx.insert(user).values(seed.users)
      await tx.insert(account).values(accounts)
      await tx.insert(organization).values(seed.organizations)
      await tx.insert(member).values(seed.members)
      await tx.insert(invitation).values(seed.invitations)
      await tx.insert(auditLog).values(seed.auditLogs)
    })
    console.log(
      `Demo seed: users=${seed.users.length} accounts=${accounts.length}`
      + ` organizations=${seed.organizations.length} members=${seed.members.length}`
      + ` invitations=${seed.invitations.length} audit_logs=${seed.auditLogs.length}`
    )
    return 0
  }
  finally {
    await pool.end()
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    // Drizzle wraps the driver error in a message that lists every bound
    // parameter (password hashes included): print the driver's cause only.
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause : error
    console.error('Demo seed failed:', reason instanceof Error ? reason.message : reason)
    process.exitCode = 1
  }
)
