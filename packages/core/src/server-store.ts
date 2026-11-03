import { serverSecrets, serverSettings, type Database } from '@rolodex/db'
import { eq } from 'drizzle-orm'
import { AppError } from './errors'
import { decryptSecret, encryptSecret } from './secrets'

export const savedSecret = '*********'

export function credentialsKey() {
  const key = process.env.CREDENTIALS_KEY
  if (!key) throw new AppError(500, 'CREDENTIALS_KEY is not configured')
  return key
}

export async function readSettings<T extends object>(db: Database, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, key)).limit(1)
  if (!row || typeof row.settings !== 'object' || row.settings === null) return fallback
  return { ...fallback, ...(row.settings as Partial<T>) }
}

export async function writeSettings(db: Database, key: string, settings: object) {
  const [existing] = await db.select({ key: serverSettings.key }).from(serverSettings).where(eq(serverSettings.key, key)).limit(1)
  if (existing) {
    await db.update(serverSettings).set({ settings, updatedAt: new Date() }).where(eq(serverSettings.key, key))
    return
  }
  await db.insert(serverSettings).values({ key, settings })
}

export async function readSecret(db: Database, key: string) {
  const [row] = await db.select().from(serverSecrets).where(eq(serverSecrets.key, key)).limit(1)
  if (!row) return ''
  return decryptSecret(row, credentialsKey())
}

export async function writeSecret(db: Database, key: string, value: string) {
  if (!value) {
    await db.delete(serverSecrets).where(eq(serverSecrets.key, key))
    return
  }
  const sealed = encryptSecret(value, credentialsKey())
  const [existing] = await db.select({ key: serverSecrets.key }).from(serverSecrets).where(eq(serverSecrets.key, key)).limit(1)
  if (existing) {
    await db.update(serverSecrets).set({ ...sealed, updatedAt: new Date() }).where(eq(serverSecrets.key, key))
    return
  }
  await db.insert(serverSecrets).values({ key, ...sealed })
}

export function keepSecret(next: string, previous: string) {
  if (next === savedSecret) return previous
  return next
}
