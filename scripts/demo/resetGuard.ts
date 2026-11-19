// SPDX-License-Identifier: MIT
// Pure decisions of scripts/demo/reset.ts: no I/O, unit-tested.

export interface DemoResetEnv {
  readonly DATABASE_URL?: string
  readonly DEMO_RESET_CONFIRM?: string
}

export type DemoResetDecision
  = | { readonly ok: true, readonly databaseUrl: string, readonly host: string }
    | { readonly ok: false, readonly reason: string }

const postgresProtocols: ReadonlySet<string> = new Set(['postgres:', 'postgresql:'])

// Parameters that pg (pg-connection-string) or postgres-js read as the
// server to reach, overriding the hostname of the URL.
const hostOverrideParams = ['host', 'hostaddr'] as const

/**
 * The hostname the database client connects to, or undefined when the URL
 * lets the client pick another target than its hostname: a host or
 * hostaddr parameter, an empty hostname (PGHOST or the local socket), a
 * percent-encoded socket path, or a scheme such as socket: whose target
 * is not the hostname.
 */
function hostnameOf(databaseUrl: string): string | undefined {
  let url: URL
  try {
    url = new URL(databaseUrl)
  }
  catch {
    return undefined
  }
  if (!postgresProtocols.has(url.protocol))
    return undefined
  if (hostOverrideParams.some(name => url.searchParams.has(name)))
    return undefined
  if (!url.hostname || url.hostname.includes('%'))
    return undefined
  return url.hostname
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
    return { ok: false, reason: 'DATABASE_URL must be a postgres:// URL naming its host, without a host or hostaddr parameter.' }

  const confirm = env.DEMO_RESET_CONFIRM
  if (!confirm)
    return { ok: false, reason: `DEMO_RESET_CONFIRM is not set: set it to "${host}" to wipe that database.` }
  if (confirm !== host)
    return { ok: false, reason: `DEMO_RESET_CONFIRM does not match the DATABASE_URL host "${host}".` }

  return { ok: true, databaseUrl, host }
}

/**
 * Environment of the migrate and seed child processes. NuxtHub prefers
 * POSTGRES_URL and POSTGRESQL_URL over DATABASE_URL, so all three point at
 * the database the guard confirmed. Deleting them is not enough: nuxt
 * prepare loads .env through c12, which fills every undefined key.
 */
export function demoResetChildEnv(
  env: Readonly<Record<string, string | undefined>>,
  databaseUrl: string
): Record<string, string | undefined> {
  return { ...env, DATABASE_URL: databaseUrl, POSTGRES_URL: databaseUrl, POSTGRESQL_URL: databaseUrl }
}
