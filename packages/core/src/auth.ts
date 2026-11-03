import { appPasswords, sessions, users, type Database } from '@rolodex/db'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { AppError } from './errors'
import { normalizeEmail } from './normalize'
import { hashPassword, verifyPassword } from './passwords'
import { hashToken, newToken } from './secrets'
import { createAddressBook } from './books'
import { createWorkspace } from './workspaces'

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

export type PublicUser = { id: string; email: string; displayName: string }

export function publicUser(user: { id: string; email: string; displayName: string }): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName }
}

async function createSession(db: Database, userId: string) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_MS)
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt })
  return { token, expiresAt }
}

export async function registerUser(
  db: Database,
  input: { email: string; password: string; displayName?: string | undefined },
) {
  const email = normalizeEmail(input.email)
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing) throw new AppError(409, 'An account with that email already exists')
  const passwordHash = await hashPassword(input.password)
  const displayName = input.displayName?.trim() || email.split('@')[0] || 'User'
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const [user] = await database
      .insert(users)
      .values({ email, passwordHash, displayName })
      .returning()
    if (!user) throw new AppError(500, 'Could not create the account')
    const workspace = await createWorkspace(database, user.id, 'Personal')
    await createAddressBook(database, user.id, workspace.id, 'Contacts')
    const session = await createSession(database, user.id)
    return { user: publicUser(user), token: session.token, expiresAt: session.expiresAt }
  })
}

export async function createOauthUser(db: Database, emailInput: string, displayName: string) {
  const email = normalizeEmail(emailInput)
  const passwordHash = await hashPassword(randomBytes(32).toString('base64url'))
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const [user] = await database.insert(users).values({ email, passwordHash, displayName: displayName.trim() || email.split('@')[0] || 'User' }).returning()
    if (!user) throw new AppError(500, 'Could not create the account')
    const workspace = await createWorkspace(database, user.id, 'Personal')
    await createAddressBook(database, user.id, workspace.id, 'Contacts')
    return user
  })
}

export async function openSession(db: Database, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) throw new AppError(404, 'Account not found')
  const session = await createSession(db, userId)
  return { user: publicUser(user), token: session.token, expiresAt: session.expiresAt }
}

export async function loginUser(db: Database, emailInput: string, password: string) {
  const email = normalizeEmail(emailInput)
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError(401, 'Email or password is incorrect')
  }
  const session = await createSession(db, user.id)
  return { user: publicUser(user), token: session.token, expiresAt: session.expiresAt }
}

export async function logoutUser(db: Database, token: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)))
}

export async function userForSession(db: Database, token: string) {
  if (!token) return null
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1)
  return row ? publicUser(row.user) : null
}

export async function createAppPassword(db: Database, userId: string, label: string) {
  const password = `rolodex_${randomBytes(24).toString('base64url')}`
  const passwordHash = await hashPassword(password)
  const [row] = await db
    .insert(appPasswords)
    .values({ userId, label: label.trim(), passwordHash })
    .returning({ id: appPasswords.id, label: appPasswords.label, createdAt: appPasswords.createdAt })
  if (!row) throw new AppError(500, 'Could not create an application password')
  return { ...row, password }
}

export async function listAppPasswords(db: Database, userId: string) {
  return db
    .select({
      id: appPasswords.id,
      label: appPasswords.label,
      createdAt: appPasswords.createdAt,
      lastUsedAt: appPasswords.lastUsedAt,
    })
    .from(appPasswords)
    .where(and(eq(appPasswords.userId, userId), isNull(appPasswords.revokedAt)))
}

export async function revokeAppPassword(db: Database, userId: string, passwordId: string) {
  const [row] = await db
    .update(appPasswords)
    .set({ revokedAt: new Date() })
    .where(and(eq(appPasswords.id, passwordId), eq(appPasswords.userId, userId), isNull(appPasswords.revokedAt)))
    .returning({ id: appPasswords.id })
  if (!row) throw new AppError(404, 'Application password not found')
}

export async function authenticateAppPassword(db: Database, emailInput: string, password: string) {
  const email = normalizeEmail(emailInput)
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user) return null
  const rows = await db
    .select()
    .from(appPasswords)
    .where(and(eq(appPasswords.userId, user.id), isNull(appPasswords.revokedAt)))
  for (const row of rows) {
    if (!(await verifyPassword(row.passwordHash, password))) continue
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60 * 1000) {
      await db.update(appPasswords).set({ lastUsedAt: new Date() }).where(eq(appPasswords.id, row.id))
    }
    return publicUser(user)
  }
  return null
}
