import { describe, expect, it } from 'vitest'
import { userDisplayName } from '~~/shared/utils/userDisplayName'

describe('userDisplayName', () => {
  it('uses the name when there is one', () => {
    expect(userDisplayName({ name: 'Ada', email: 'ada@example.test' })).toBe('Ada')
  })

  it.each([null, undefined, ''])('falls back to the email local part when the name is %j', (name) => {
    expect(userDisplayName({ name, email: 'ada@example.test' })).toBe('ada')
  })

  it('falls back to the whole email when its local part is empty', () => {
    expect(userDisplayName({ name: '', email: '@example.test' })).toBe('@example.test')
  })
})
