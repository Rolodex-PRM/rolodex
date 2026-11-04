import { requireManager } from './access'
import { readSettings, writeSettings } from './server-store'
import type { Database } from '@rolodex/db'

const settingKey = 'trash'
const fallback = { retentionDays: 30 }

export async function trashPolicy(db: Database) {
  const stored = await readSettings(db, settingKey, fallback)
  const days = Number(stored.retentionDays)
  return { retentionDays: Number.isInteger(days) && days >= 1 && days <= 3650 ? days : fallback.retentionDays }
}

export async function setTrashPolicy(db: Database, userId: string, workspaceId: string, retentionDays: number) {
  await requireManager(db, userId, workspaceId)
  await writeSettings(db, settingKey, { retentionDays })
  return trashPolicy(db)
}
