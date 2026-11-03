import { createECDH, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySignedJwt } from './oauth'
import { formatData, mailboxAddress } from './smtp'
import { decryptPushPayload, encryptPushPayload } from './web-push'

describe('sign-in tokens', () => {
  it('accepts an RS256 identity token and rejects an unsigned one', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = publicKey.export({ format: 'jwk' })
    const now = Math.floor(Date.now() / 1000)
    const claims = { iss: 'https://id.example', aud: 'rolodex', exp: now + 600, nonce: 'n', sub: 'person' }
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signer = createSign('RSA-SHA256')
    signer.update(`${header}.${body}`)
    const token = `${header}.${body}.${signer.sign(privateKey).toString('base64url')}`
    const verified = await verifySignedJwt(token, { alg: 'RS256', issuer: 'https://id.example', audience: 'rolodex', nonce: 'n', jwks: [jwk as Record<string, unknown>] })
    expect(verified.sub).toBe('person')
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${body}.`
    await expect(verifySignedJwt(unsigned, { alg: 'RS256', issuer: 'https://id.example', audience: 'rolodex', jwks: [jwk as Record<string, unknown>] })).rejects.toThrow(/not valid|signature/i)
  })
})

describe('notifications', () => {
  it('reads a display name and address from the from line', () => {
    expect(mailboxAddress('Rolodex <ada@example.com>')).toBe('ada@example.com')
  })

  it('dot-stuffs message lines', () => {
    expect(formatData({ from: 'Ada <ada@example.com>', to: 'ada@example.com', subject: 'Hello', text: '.secret' })).toContain('\r\n..secret')
  })

  it('round-trips a web push payload', () => {
    const user = createECDH('prime256v1')
    user.generateKeys()
    const auth = randomBytes(16)
    const body = encryptPushPayload('{"title":"Hello"}', { p256dh: user.getPublicKey().toString('base64url'), auth: auth.toString('base64url') })
    expect(decryptPushPayload(body, user.getPrivateKey(), auth)).toBe('{"title":"Hello"}')
  })
})
