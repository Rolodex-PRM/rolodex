import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { users, type Database } from '@rolodex/db'
import { eq } from 'drizzle-orm'
import { requireManager } from './access'
import { openSession } from './auth'
import { AppError } from './errors'
import { sendAccountEmail } from './notify'
import { readSettings, writeSettings } from './server-store'
import { createTotpSecret, otpauthUri, verifyTotp } from './totp'

const settingKey = 'security'
const ticketMs = 5 * 60 * 1000
const emailCodeMs = 10 * 60 * 1000

type Method = 'authenticator' | 'email'
type Ticket = { purpose: 'mfa' | 'enroll'; userId: string; secret?: string; exp: number }
type Policy = { required: boolean; authenticator: boolean; email: boolean }

export async function twoFactorPolicy(db: Database): Promise<Policy> {
  const stored = await readSettings(db, settingKey, { twoFactorRequired: false, authenticator: true, email: true })
  return {
    required: stored.twoFactorRequired === true,
    authenticator: stored.authenticator !== false,
    email: stored.email !== false,
  }
}

export async function setTwoFactorPolicy(db: Database, userId: string, workspaceId: string, input: Policy) {
  await requireManager(db, userId, workspaceId)
  if (input.required && !input.authenticator && !input.email) {
    throw new AppError(400, 'Keep an authenticator app or email codes while a second factor is required')
  }
  await writeSettings(db, settingKey, { twoFactorRequired: input.required, authenticator: input.authenticator, email: input.email })
  return twoFactorPolicy(db)
}

export async function twoFactorStatus(db: Database, userId: string) {
  const policy = await twoFactorPolicy(db)
  const [user] = await db.select({ totpEnabled: users.totpEnabled }).from(users).where(eq(users.id, userId)).limit(1)
  return { ...policy, enabled: user?.totpEnabled === true }
}

export function startEnrollment(email: string) {
  const secret = createTotpSecret()
  return { secret, otpauth: otpauthUri(email, secret) }
}

export async function confirmEnrollment(db: Database, userId: string, secret: string, code: string) {
  if (!verifyTotp(secret, code)) throw new AppError(400, 'That code did not match')
  await db.update(users).set({ totpSecret: secret, totpEnabled: true, updatedAt: new Date() }).where(eq(users.id, userId))
  return twoFactorStatus(db, userId)
}

export async function disableTwoFactor(db: Database, userId: string, code: string) {
  const policy = await twoFactorPolicy(db)
  if (policy.required && !policy.email) throw new AppError(400, 'An administrator requires an authenticator app')
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user?.totpSecret || !verifyTotp(user.totpSecret, code)) throw new AppError(400, 'That code did not match')
  await db.update(users).set({ totpSecret: null, totpEnabled: false, updatedAt: new Date() }).where(eq(users.id, userId))
  return twoFactorStatus(db, userId)
}

export async function gateUser(db: Database, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new AppError(401, 'Email or password is incorrect')
  const policy = await twoFactorPolicy(db)
  if (user.totpEnabled) {
    const methods: Method[] = ['authenticator']
    if (policy.email) methods.push('email')
    return { kind: 'mfa' as const, ticket: signTicket({ purpose: 'mfa', userId: user.id, exp: Date.now() + ticketMs }), methods }
  }
  if (policy.required && policy.authenticator) {
    const secret = createTotpSecret()
    const methods: Method[] = ['authenticator']
    if (policy.email) methods.push('email')
    return {
      kind: 'enroll' as const,
      ticket: signTicket({ purpose: 'enroll', userId: user.id, secret, exp: Date.now() + ticketMs }),
      secret,
      otpauth: otpauthUri(user.email, secret),
      methods,
    }
  }
  if (policy.required && policy.email) {
    return { kind: 'mfa' as const, ticket: signTicket({ purpose: 'mfa', userId: user.id, exp: Date.now() + ticketMs }), methods: ['email'] as Method[] }
  }
  return { kind: 'session' as const }
}

export async function sendLoginEmailCode(db: Database, ticket: string) {
  const payload = readTicket(ticket)
  const policy = await twoFactorPolicy(db)
  if (!policy.email) throw new AppError(400, 'Email codes are turned off')
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1)
  if (!user) throw new AppError(401, 'That sign-in expired. Start again.')
  if (user.emailOtpExpiresAt && user.emailOtpExpiresAt.getTime() - Date.now() > 9 * 60 * 1000) {
    throw new AppError(429, 'A code was just sent. Wait a minute and try again.')
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const emailOtpExpiresAt = new Date(Date.now() + emailCodeMs)
  await db.update(users).set({ emailOtpHash: hashEmailCode(user.id, code), emailOtpExpiresAt, updatedAt: new Date() }).where(eq(users.id, user.id))
  try {
    await sendAccountEmail(
      db,
      user.email,
      'Your Rolodex sign-in code',
      `Your Rolodex sign-in code is ${code}. It expires in 10 minutes. If you did not try to sign in, you can ignore this message.`,
    )
  } catch (error) {
    await db.update(users).set({ emailOtpHash: null, emailOtpExpiresAt: null }).where(eq(users.id, user.id))
    throw error
  }
  return { sent: true }
}

export async function sendTwoFactorTest(db: Database, userId: string) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new AppError(401, 'Sign in again')
  await sendAccountEmail(
    db,
    user.email,
    'Rolodex can email sign-in codes',
    'This is a test from Rolodex. When a second factor is required, sign-in codes will arrive from this address. This message is not a sign-in code.',
  )
  return { sent: true }
}

export function matchEmailCode(userId: string, code: string, hash: string, expiresAt: Date, now = Date.now()) {
  const cleaned = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned) || expiresAt.getTime() < now) return false
  const expected = hashEmailCode(userId, cleaned)
  const left = Buffer.from(hash)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function finishSecondFactor(db: Database, ticket: string, code: string, remember = false) {
  const payload = readTicket(ticket)
  const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1)
  if (!user) throw new AppError(401, 'That sign-in expired. Start again.')
  const totpSecret = payload.purpose === 'enroll' ? payload.secret : user.totpEnabled ? user.totpSecret : null
  const totpOk = Boolean(totpSecret && verifyTotp(totpSecret, code))
  const emailOk = Boolean(user.emailOtpHash && user.emailOtpExpiresAt && matchEmailCode(user.id, code, user.emailOtpHash, user.emailOtpExpiresAt))
  if (!totpOk && !emailOk) throw new AppError(401, 'That code did not match')
  if (payload.purpose === 'enroll' && totpOk && payload.secret) {
    await db.update(users).set({ totpSecret: payload.secret, totpEnabled: true, emailOtpHash: null, emailOtpExpiresAt: null, updatedAt: new Date() }).where(eq(users.id, user.id))
  } else if (emailOk) {
    await db.update(users).set({ emailOtpHash: null, emailOtpExpiresAt: null, updatedAt: new Date() }).where(eq(users.id, user.id))
  }
  return openSession(db, user.id, remember)
}

function hashEmailCode(userId: string, code: string) {
  return createHash('sha256').update(`${ticketKey()}:${userId}:${code}`).digest('hex')
}

function ticketKey() {
  return process.env.CREDENTIALS_KEY || process.env.DATABASE_URL || 'rolodex-dev'
}

function signTicket(payload: Ticket) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', ticketKey()).update(body).digest('base64url')
  return `${body}.${signature}`
}

function readTicket(ticket: string): Ticket {
  const [body, signature] = ticket.split('.')
  if (!body || !signature) throw new AppError(401, 'That sign-in expired. Start again.')
  const expected = createHmac('sha256', ticketKey()).update(body).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new AppError(401, 'That sign-in expired. Start again.')
  let payload: Ticket
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Ticket
  } catch {
    throw new AppError(401, 'That sign-in expired. Start again.')
  }
  if ((payload.purpose !== 'mfa' && payload.purpose !== 'enroll') || !payload.userId || payload.exp < Date.now()) {
    throw new AppError(401, 'That sign-in expired. Start again.')
  }
  return payload
}
