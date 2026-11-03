import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, createSign, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto'

const encoder = new TextEncoder()

export type PushKeys = { publicKey: string; privateKey: string }

export function createPushKeys(): PushKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x ?? '', 'base64url'), Buffer.from(jwk.y ?? '', 'base64url')])
  return {
    publicKey: raw.toString('base64url'),
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
}

export function encryptPushPayload(payload: string, subscription: { p256dh: string; auth: string }) {
  const userPublic = Buffer.from(subscription.p256dh, 'base64url')
  const auth = Buffer.from(subscription.auth, 'base64url')
  const sender = createECDH('prime256v1')
  sender.generateKeys()
  const senderPublic = sender.getPublicKey()
  const shared = sender.computeSecret(userPublic)
  const keyInfo = Buffer.concat([encoder.encode('WebPush: info\0'), userPublic, senderPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32))
  const salt = randomBytes(16)
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12))
  const record = Buffer.concat([Buffer.from(payload), Buffer.from([2])])
  const cipher = createCipher(contentKey, nonce, record)
  const header = Buffer.concat([salt, uint32(4096), Buffer.from([senderPublic.length]), senderPublic])
  return Buffer.concat([header, cipher])
}

export function decryptPushPayload(body: Buffer, privateKey: Buffer, auth: Buffer) {
  const salt = body.subarray(0, 16)
  const idLength = body[20] ?? 0
  const senderPublic = body.subarray(21, 21 + idLength)
  const ciphertext = body.subarray(21 + idLength)
  const user = createECDH('prime256v1')
  user.setPrivateKey(privateKey)
  const shared = user.computeSecret(senderPublic)
  const keyInfo = Buffer.concat([encoder.encode('WebPush: info\0'), user.getPublicKey(), senderPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, keyInfo, 32))
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12))
  const tag = ciphertext.subarray(ciphertext.length - 16)
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce)
  decipher.setAuthTag(tag)
  const record = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()])
  let end = record.length
  while (end > 0 && record[end - 1] === 0) end -= 1
  if (record[end - 1] !== 2) throw new Error('Push payload padding was not valid')
  return record.subarray(0, end - 1).toString('utf8')
}

export function vapidAuthorization(endpoint: string, keys: PushKeys, subject: string) {
  const audience = new URL(endpoint).origin
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const body = base64url(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject }))
  const signature = signEs256(createPrivateKey(keys.privateKey), `${header}.${body}`)
  return `vapid t=${header}.${body}.${signature},k=${keys.publicKey}`
}

export async function postPush(endpoint: string, body: Buffer, authorization: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
    },
    body: new Uint8Array(body),
  })
  if (response.status === 404 || response.status === 410) return 'gone' as const
  if (!response.ok) throw new Error(`Push service returned ${response.status}`)
  return 'sent' as const
}

function createCipher(key: Buffer, nonce: Buffer, record: Buffer) {
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  return Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()])
}

function signEs256(key: KeyObject, value: string) {
  const signer = createSign('SHA256')
  signer.update(value)
  return derToRaw(signer.sign(key)).toString('base64url')
}

function derToRaw(der: Buffer) {
  let offset = der[1]! < 128 ? 2 : 2 + (der[1]! & 0x7f)
  const read = () => {
    if (der[offset] !== 0x02) throw new Error('Could not sign the push request')
    const length = der[offset + 1]!
    const start = offset + 2
    offset = start + length
    const bytes = der.subarray(start, offset)
    const trimmed = bytes[0] === 0 ? bytes.subarray(1) : bytes
    if (trimmed.length > 32) throw new Error('Could not sign the push request')
    return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed])
  }
  return Buffer.concat([read(), read()])
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function base64url(value: string) {
  return Buffer.from(value).toString('base64url')
}
