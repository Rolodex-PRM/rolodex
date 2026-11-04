import { describe, expect, it } from 'vitest'
import { matchEmailCode } from './two-factor'
import { createHash } from 'node:crypto'

describe('email sign-in codes', () => {
  it('accepts the code until it expires', () => {
    const userId = 'user-1'
    const code = '042813'
    const hash = createHash('sha256').update(`${process.env.CREDENTIALS_KEY || process.env.DATABASE_URL || 'rolodex-dev'}:${userId}:${code}`).digest('hex')
    const expires = new Date(Date.now() + 60_000)
    expect(matchEmailCode(userId, code, hash, expires)).toBe(true)
    expect(matchEmailCode(userId, '000000', hash, expires)).toBe(false)
    expect(matchEmailCode(userId, code, hash, new Date(Date.now() - 1000))).toBe(false)
  })
})
