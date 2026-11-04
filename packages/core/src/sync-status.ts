import { appPasswords, contacts, type Database } from '@rolodex/db'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { requireMembership } from './access'
import { visibleContactSql } from './contacts'

export async function syncStatus(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const passwords = await db
    .select({ lastUsedAt: appPasswords.lastUsedAt })
    .from(appPasswords)
    .where(and(eq(appPasswords.userId, userId), isNull(appPasswords.revokedAt)))
  const last = passwords.reduce<Date | null>((latest, row) => {
    if (!row.lastUsedAt) return latest
    if (!latest || row.lastUsedAt > latest) return row.lastUsedAt
    return latest
  }, null)
  const filters = [eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)]
  if (last) filters.push(gt(contacts.updatedAt, last))
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(...filters))
  const pending = await db
    .select({ id: contacts.id, displayName: contacts.displayName, updatedAt: contacts.updatedAt })
    .from(contacts)
    .where(and(...filters))
    .orderBy(desc(contacts.updatedAt))
    .limit(20)
  return {
    lastCheckedIn: last ? last.toISOString() : null,
    pendingCount: countRow?.total ?? 0,
    pending: pending.map((row) => ({ id: row.id, displayName: row.displayName, updatedAt: row.updatedAt.toISOString() })),
  }
}
