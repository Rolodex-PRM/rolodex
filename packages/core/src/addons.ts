import { integrations, type Database } from '@rolodex/db'
import { and, eq } from 'drizzle-orm'
import { requireManager } from './access'
import { AppError } from './errors'

export const addonCatalog = [
  {
    id: 'immich',
    name: 'Immich',
    description: 'Link recognized people and their photos. The photos stay in Immich.',
  },
  {
    id: 'ai',
    name: 'AI',
    description: 'Suggest contact fields from public pages. Nothing is saved until you approve it.',
  },
  {
    id: 'mcp',
    name: 'MCP Server',
    description: 'Let AI clients read contacts, relationships, and interactions at /mcp.',
  },
] as const

export type AddonId = (typeof addonCatalog)[number]['id']

export async function addonEnabled(db: Database, workspaceId: string, id: AddonId) {
  const [row] = await db
    .select({ status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'addon'), eq(integrations.name, id), eq(integrations.status, 'enabled')))
    .limit(1)
  return Boolean(row)
}

export async function listAddons(db: Database, userId: string, workspaceId: string) {
  await requireManager(db, userId, workspaceId)
  const rows = await db
    .select({ name: integrations.name, status: integrations.status })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'addon')))
  const enabled = new Set(rows.filter((row) => row.status === 'enabled').map((row) => row.name))
  return addonCatalog.map((addon) => ({ ...addon, enabled: enabled.has(addon.id) }))
}

export async function setAddon(db: Database, userId: string, workspaceId: string, id: string, enabled: boolean) {
  await requireManager(db, userId, workspaceId)
  const addon = addonCatalog.find((item) => item.id === id)
  if (!addon) throw new AppError(404, 'Add-on not found')
  const [existing] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'addon'), eq(integrations.name, addon.id)))
    .limit(1)
  const status = enabled ? 'enabled' : 'disabled'
  if (existing) {
    await db.update(integrations).set({ status, updatedAt: new Date() }).where(eq(integrations.id, existing.id))
  } else if (enabled) {
    await db.insert(integrations).values({ workspaceId, provider: 'addon', name: addon.id, status, settings: {} })
  }
  return { ...addon, enabled }
}
