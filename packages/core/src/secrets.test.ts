import { describe, expect, it } from 'vitest'
import { canManageMembers, canWriteContacts } from './permissions'
import { decryptSecret, encryptSecret, etagMatches } from './secrets'

const key = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')

describe('secrets and permissions', () => {
  it('round-trips an encrypted credential', () => {
    const payload = encryptSecret('immich-api-key', key)
    expect(decryptSecret(payload, key)).toBe('immich-api-key')
    expect(payload.ciphertext).not.toContain('immich-api-key')
  })

  it('compares CardDAV etags', () => {
    expect(etagMatches('"abc"', 'abc')).toBe(true)
    expect(etagMatches('W/"abc"', 'abc')).toBe(true)
    expect(etagMatches('*', 'abc')).toBe(true)
    expect(etagMatches('"nope"', 'abc')).toBe(false)
  })

  it('maps workspace roles', () => {
    expect(canWriteContacts('editor')).toBe(true)
    expect(canWriteContacts('contributor')).toBe(false)
    expect(canWriteContacts('viewer')).toBe(false)
    expect(canManageMembers('administrator')).toBe(true)
    expect(canManageMembers('editor')).toBe(false)
  })
})
