import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export function newToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function makeEtag(body: string) {
  return createHash('sha256').update(body).digest('hex').slice(0, 32)
}

export function etagMatches(header: string, current: string) {
  const expected = current.replaceAll('"', '')
  return header.split(',').some((part) => {
    const token = part.trim()
    if (token === '*') return true
    const normalized = token.replace(/^W\//i, '').replaceAll('"', '')
    return normalized === expected
  })
}

function keyFrom(keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64')
  if (key.length !== 32) {
    throw new Error('CREDENTIALS_KEY must decode to 32 bytes')
  }
  return key
}

export function encryptSecret(plaintext: string, keyBase64: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyBase64), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([ciphertext, tag]).toString('base64'),
    nonce: iv.toString('base64'),
  }
}

export function decryptSecret(payload: { ciphertext: string; nonce: string }, keyBase64: string) {
  const iv = Buffer.from(payload.nonce, 'base64')
  const data = Buffer.from(payload.ciphertext, 'base64')
  const tag = data.subarray(data.length - 16)
  const body = data.subarray(0, data.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyBase64), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
