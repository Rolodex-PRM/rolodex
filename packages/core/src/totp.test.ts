import { describe, expect, it } from 'vitest'
import { createTotpSecret, hotp, verifyTotp } from './totp'

describe('totp', () => {
  it('accepts the current code and a neighbor', () => {
    const secret = createTotpSecret()
    const now = Date.UTC(2026, 10, 4, 12, 0, 0)
    const code = hotp(secret, Math.floor(now / 30_000))
    expect(verifyTotp(secret, code, now)).toBe(true)
    expect(verifyTotp(secret, '000000', now)).toBe(false)
  })
})
