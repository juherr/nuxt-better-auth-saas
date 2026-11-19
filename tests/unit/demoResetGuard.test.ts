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

  it('never echoes the password of DATABASE_URL in its reason', () => {
    const decision = checkDemoResetTarget({ DATABASE_URL: databaseUrl, DEMO_RESET_CONFIRM: 'other' })
    expect(decision.ok).toBe(false)
    expect(JSON.stringify(decision)).not.toContain('secret')
  })
})

describe('demoResetChildEnv', () => {
  it('points the child processes at the confirmed DATABASE_URL only', () => {
    const env = demoResetChildEnv(
      { PATH: '/bin', POSTGRES_URL: 'postgres://elsewhere/db', POSTGRESQL_URL: 'postgres://other/db' },
      databaseUrl
    )
    expect(env).toEqual({ PATH: '/bin', DATABASE_URL: databaseUrl })
  })
})
