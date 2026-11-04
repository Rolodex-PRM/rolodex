import { createHmac, randomBytes } from 'node:crypto'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function createTotpSecret() {
  return base32Encode(randomBytes(20))
}

export function otpauthUri(email: string, secret: string) {
  const label = encodeURIComponent(`Rolodex:${email}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=Rolodex&algorithm=SHA1&digits=6&period=30`
}

export function verifyTotp(secret: string, code: string, now = Date.now()) {
  const cleaned = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const counter = Math.floor(now / 30_000)
  return [-1, 0, 1].some((skew) => hotp(secret, counter + skew) === cleaned)
}

export function hotp(secret: string, counter: number) {
  const key = base32Decode(secret)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0xf
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0)
  return String(binary % 1_000_000).padStart(6, '0')
}

function base32Encode(bytes: Buffer) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(secret: string) {
  const cleaned = secret.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of cleaned) {
    const index = alphabet.indexOf(char)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}
