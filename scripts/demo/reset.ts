// Wipes the demo database, applies the migrations and writes the demo seed.
//
//   DEMO_RESET_CONFIRM=<host of DATABASE_URL> pnpm demo:reset
//
// Refuses to touch anything unless DEMO_RESET_CONFIRM equals the hostname
// of DATABASE_URL (scripts/demo/resetGuard.ts).
//
// Prerequisites:
// - the migrations must already be generated (`pnpm db:generate`):
//   server/db/migrations is gitignored, and `nuxt db migrate` applies only
//   what that folder holds;
// - `nuxt db migrate` loads the Nuxt config: run `nuxt prepare` (done by
//   `pnpm install`) first on a fresh checkout.
//
// Steps:
// 1. DROP SCHEMA public CASCADE, CREATE SCHEMA public, DROP SCHEMA drizzle.
//    NuxtHub records applied migrations in an unqualified `_hub_migrations`
//    table (@nuxthub/core dist/db/lib/utils.mjs), so it lives in the first
//    schema of search_path, normally `public`. drizzle-kit records its own
//    in `drizzle.__drizzle_migrations`. Both must go, otherwise migrate is
//    a no-op over an empty schema; the script checks that no
//    `_hub_migrations` remains visible before going on.
// 2. `npx nuxt db migrate` (never `pnpm db:migrate`, see
//    docs/SELF_HOSTING_NODE.md).
// 3. scripts/demo/seed.ts.
//
// Run with plain Node 26 (type stripping): relative imports carry `.ts`.
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { checkDemoResetTarget, demoResetChildEnv } from './resetGuard.ts'
import 'dotenv/config'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const seedScript = fileURLToPath(new URL('./seed.ts', import.meta.url))

async function wipeSchemas(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    await client.query('BEGIN')
    // A live app holding a lock must make the reset fail, not hang.
    await client.query('SET LOCAL lock_timeout = \'10s\'')
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')
    // Restore the default privilege of a fresh database on `public`.
    await client.query('GRANT USAGE ON SCHEMA public TO PUBLIC')
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
    const left = await client.query<{ table: string | null }>('SELECT to_regclass(\'_hub_migrations\')::text AS table')
    const remaining = left.rows[0]?.table
    if (remaining)
      throw new Error(`${remaining} survived the wipe: it is outside the public schema, drop it by hand.`)
    await client.query('COMMIT')
  }
  catch (error) {
    // Keep the original error: a ROLLBACK on a broken connection fails too.
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
  finally {
    await client.end()
  }
}

function run(label: string, command: string, args: readonly string[], env: Record<string, string | undefined>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env, stdio: 'inherit' })
    child.on('error', error => reject(new Error(`${label} could not start: ${error.message}`)))
    child.on('exit', (code, signal) => {
      if (code === 0)
        resolve()
      else
        reject(new Error(`${label} failed (${signal ? `signal ${signal}` : `exit code ${code}`})`))
    })
  })
}

async function main(): Promise<number> {
  const decision = checkDemoResetTarget({
    DATABASE_URL: process.env.DATABASE_URL,
    DEMO_RESET_CONFIRM: process.env.DEMO_RESET_CONFIRM
  })
  if (!decision.ok) {
    console.error(`Demo reset refused: ${decision.reason}`)
    return 1
  }

  console.log(`Demo reset: wiping the public and drizzle schemas on ${decision.host}`)
  await wipeSchemas(decision.databaseUrl)

  const env = demoResetChildEnv(process.env, decision.databaseUrl)
  await run('nuxt db migrate', 'npx', ['nuxt', 'db', 'migrate'], env)
  await run('Demo seed', process.execPath, [seedScript], env)
  console.log('Demo reset: done')
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error('Demo reset failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
)
