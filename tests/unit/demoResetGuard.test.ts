import { describe, expect, it } from 'vitest'
import { checkDemoResetTarget, demoResetChildEnv } from '~~/scripts/demo/resetGuard'

const databaseUrl = 'postgres://demo:secret@db.example.com:5432/demo'

describe('checkDemoResetTarget', () => {
  it('allows the reset when DEMO_RESET_CONFIRM equals the hostname of DATABASE_URL', () => {
    expect(checkDemoResetTarget({ DATABASE_URL: databaseUrl, DEMO_RESET_CONFIRM: 'db.example.com' }))
      .toEqual({ ok: true, databaseUrl, host: 'db.example.com' })
  })

  it('allows a local database confirmed as localhost', () => {
    expect(checkDemoResetTarget({
      DATABASE_URL: 'postgres://smoke:smoke-password@localhost:5432/smoke',
      DEMO_RESET_CONFIRM: 'localhost'
    })).toMatchObject({ ok: true, host: 'localhost' })
  })

  it.each([
    ['another host', 'prod.example.com'],
    ['the host with its port', 'db.example.com:5432'],
    ['a prefix of the host', 'db'],
    ['the host padded with spaces', ' db.example.com ']
  ])('refuses when DEMO_RESET_CONFIRM is %s', (_label, confirm) => {
    const decision = checkDemoResetTarget({ DATABASE_URL: databaseUrl, DEMO_RESET_CONFIRM: confirm })
    expect(decision.ok).toBe(false)
    expect(decision).toMatchObject({ reason: expect.stringContaining('db.example.com') })
  })

  it.each([
    ['unset', undefined],
    ['empty', '']
  ])('refuses when DEMO_RESET_CONFIRM is %s', (_label, confirm) => {
    const decision = checkDemoResetTarget({ DATABASE_URL: databaseUrl, DEMO_RESET_CONFIRM: confirm })
    expect(decision).toMatchObject({ ok: false, reason: expect.stringContaining('DEMO_RESET_CONFIRM') })
  })

  it.each([
    ['unset', undefined],
    ['empty', '']
  ])('refuses when DATABASE_URL is %s', (_label, url) => {
    const decision = checkDemoResetTarget({ DATABASE_URL: url, DEMO_RESET_CONFIRM: 'localhost' })
    expect(decision).toMatchObject({ ok: false, reason: expect.stringContaining('DATABASE_URL') })
  })

  it.each([
    ['not a URL', 'not a url'],
    ['a URL without a host', 'postgres:///demo']
  ])('refuses when DATABASE_URL is %s', (_label, url) => {
    const decision = checkDemoResetTarget({ DATABASE_URL: url, DEMO_RESET_CONFIRM: 'localhost' })
    expect(decision).toMatchObject({ ok: false, reason: expect.stringContaining('DATABASE_URL') })
  })

  it.each([
    ['a host parameter naming another server', 'postgres://u:p@localhost:5432/db?host=prod.example.com'],
    ['a host parameter naming a socket', 'postgres://u:p@localhost:5432/db?host=/cloudsql/x'],
    ['a hostaddr parameter', 'postgres://u:p@localhost:5432/db?hostaddr=10.0.0.1'],
    ['an empty host parameter', 'postgres://u:p@localhost:5432/db?sslmode=disable&host='],
    ['an empty host', 'postgres:///db'],
    ['credentials and an empty host', 'postgres://u:p@/db'],
    ['the socket: scheme', 'socket://u:p@localhost/var/run/postgresql?db=db'],
    ['a scheme other than postgres', 'mysql://u:p@localhost:3306/db'],
    ['a percent-encoded socket path as host', 'postgres://u:p@%2Fvar%2Frun%2Fpostgresql/db', '%2Fvar%2Frun%2Fpostgresql']
  ])('refuses a DATABASE_URL with %s, whatever DEMO_RESET_CONFIRM says', (_label, url, confirm = 'localhost') => {
    const decision = checkDemoResetTarget({ DATABASE_URL: url, DEMO_RESET_CONFIRM: confirm })
    expect(decision).toMatchObject({ ok: false, reason: expect.stringContaining('DATABASE_URL') })
    expect(JSON.stringify(decision)).not.toContain(':p@')
  })

  it('accepts the postgresql scheme and parameters that keep the host', () => {
    expect(checkDemoResetTarget({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db?sslmode=disable&port=5433',
      DEMO_RESET_CONFIRM: 'localhost'
    })).toMatchObject({ ok: true, host: 'localhost' })
  })

  it('never echoes the password of DATABASE_URL in its reason', () => {
    const decision = checkDemoResetTarget({ DATABASE_URL: databaseUrl, DEMO_RESET_CONFIRM: 'other' })
    expect(decision.ok).toBe(false)
    expect(JSON.stringify(decision)).not.toContain('secret')
  })
})

describe('demoResetChildEnv', () => {
  it('points every URL NuxtHub reads at the confirmed DATABASE_URL', () => {
    const env = demoResetChildEnv(
      { PATH: '/bin', POSTGRES_URL: 'postgres://elsewhere/db', POSTGRESQL_URL: 'postgres://other/db' },
      databaseUrl
    )
    expect(env).toEqual({ PATH: '/bin', DATABASE_URL: databaseUrl, POSTGRES_URL: databaseUrl, POSTGRESQL_URL: databaseUrl })
  })

  // nuxt prepare loads .env through c12, which fills every key left
  // undefined: a deleted POSTGRES_URL would come back from .env.
  it('defines POSTGRES_URL and POSTGRESQL_URL even when the parent has neither', () => {
    const env = demoResetChildEnv({ PATH: '/bin' }, databaseUrl)
    expect(env).toMatchObject({ POSTGRES_URL: databaseUrl, POSTGRESQL_URL: databaseUrl })
  })
})
