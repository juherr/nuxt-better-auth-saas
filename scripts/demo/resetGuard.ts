// Pure decisions of scripts/demo/reset.ts: no I/O, unit-tested.

export interface DemoResetEnv {
  readonly DATABASE_URL?: string
  readonly DEMO_RESET_CONFIRM?: string
}

export type DemoResetDecision
  = | { readonly ok: true, readonly databaseUrl: string, readonly host: string }
    | { readonly ok: false, readonly reason: string }

function hostnameOf(databaseUrl: string): string | undefined {
  try {
    return new URL(databaseUrl).hostname || undefined
  }
  catch {
    return undefined
  }
}

/**
 * The reset drops every table of the target database. It runs only when
 * DEMO_RESET_CONFIRM repeats the hostname of DATABASE_URL exactly, so a
 * production URL left in the environment is never wiped by mistake.
 * Reasons name the host, never the full URL (it carries the password).
 */
export function checkDemoResetTarget(env: DemoResetEnv): DemoResetDecision {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl)
    return { ok: false, reason: 'DATABASE_URL is not set: point it at the demo database to reset.' }

  const host = hostnameOf(databaseUrl)
  if (host === undefined)
    return { ok: false, reason: 'DATABASE_URL is not a URL with a hostname.' }

  const confirm = env.DEMO_RESET_CONFIRM
  if (!confirm)
    return { ok: false, reason: `DEMO_RESET_CONFIRM is not set: set it to "${host}" to wipe that database.` }
  if (confirm !== host)
    return { ok: false, reason: `DEMO_RESET_CONFIRM does not match the DATABASE_URL host "${host}".` }

  return { ok: true, databaseUrl, host }
}

/**
 * Environment of the migrate and seed child processes. NuxtHub prefers
 * POSTGRES_URL and POSTGRESQL_URL over DATABASE_URL, so both are removed:
 * the children must hit the database the guard confirmed.
 */
export function demoResetChildEnv(
  env: Readonly<Record<string, string | undefined>>,
  databaseUrl: string
): Record<string, string | undefined> {
  const { POSTGRES_URL: _postgresUrl, POSTGRESQL_URL: _postgresqlUrl, ...rest } = env
  return { ...rest, DATABASE_URL: databaseUrl }
}
