import { randomUUID } from 'node:crypto'
import {
  addresses,
  contactMethods,
  contactTags,
  contacts,
  pluginDocuments,
  pluginFiles,
  relationships,
  tags,
  type Database,
} from '@rolodex/db'
import { isPluginId, pluginDocumentBody, pluginFilePayload, type PluginPermission } from '@rolodex/plugin-sdk'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { requireMembership, requireWriter } from './access'
import { suggestPluginText } from './ai'
import { visibleContactSql } from './contacts'
import { AppError } from './errors'

type Granted = { permissions: readonly PluginPermission[] }

function allow(plugin: Granted, permission: PluginPermission) {
  if (!plugin.permissions.includes(permission)) throw new AppError(403, 'This plugin is not allowed to do that')
}

function collectionName(value: unknown) {
  if (typeof value !== 'string' || !isPluginId(value)) throw new AppError(400, 'Use a short collection name')
  return value
}

function recordId(value: unknown) {
  if (typeof value !== 'string' || !isPluginId(value)) throw new AppError(400, 'Use a short record id')
  return value
}

function pageOffset(value: unknown) {
  const offset = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
  if (offset < 0 || offset > 100_000) throw new AppError(400, 'Choose a page within the list')
  return offset
}

export async function queryPluginContacts(db: Database, userId: string, workspaceId: string, plugin: Granted, offsetValue: unknown) {
  await requireMembership(db, userId, workspaceId)
  allow(plugin, 'contacts:read')
  const offset = pageOffset(offsetValue)
  const where = and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId))
  const counted = await db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(where)
  const total = counted[0]?.total ?? 0
  const people = await db
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
      preferredName: contacts.preferredName,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      preferredCommunication: contacts.preferredCommunication,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    })
    .from(contacts)
    .where(where)
    .orderBy(asc(contacts.displayName))
    .limit(100)
    .offset(offset)
  const ids = people.map((person) => person.id)
  if (!ids.length) return { contacts: [], total: Number(total) }
  const methods = await db.select().from(contactMethods).where(inArray(contactMethods.contactId, ids))
  const places = await db.select().from(addresses).where(inArray(addresses.contactId, ids))
  const labels = await db
    .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tagId))
    .where(inArray(contactTags.contactId, ids))
  const edges = await db
    .select({ fromContactId: relationships.fromContactId, toContactId: relationships.toContactId, type: relationships.type })
    .from(relationships)
    .where(and(eq(relationships.workspaceId, workspaceId), inArray(relationships.fromContactId, ids)))
  const otherIds = [...new Set(edges.map((edge) => edge.toContactId))]
  const visibleOthers = otherIds.length
    ? await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), inArray(contacts.id, otherIds), visibleContactSql(userId)))
    : []
  const visible = new Set(visibleOthers.map((person) => person.id))
  return {
    total: Number(total),
    contacts: people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      preferredName: person.preferredName ?? '',
      firstName: person.firstName ?? '',
      lastName: person.lastName ?? '',
      preferredCommunication: person.preferredCommunication ?? '',
      createdAt: person.createdAt.toISOString(),
      updatedAt: person.updatedAt.toISOString(),
      emails: methods.filter((method) => method.contactId === person.id && method.kind === 'email').map((method) => ({ label: method.label, value: method.value, primary: method.isPrimary })),
      phones: methods.filter((method) => method.contactId === person.id && method.kind === 'phone').map((method) => ({ label: method.label, value: method.value, primary: method.isPrimary })),
      tags: labels.filter((tag) => tag.contactId === person.id).map((tag) => ({ id: tag.id, name: tag.name })),
      addresses: places.filter((place) => place.contactId === person.id).map((place) => ({
        id: place.id,
        label: place.label,
        street: place.street,
        street2: place.street2,
        city: place.city,
        region: place.region,
        postalCode: place.postalCode,
        country: place.country,
      })),
      relationships: edges
        .filter((edge) => edge.fromContactId === person.id && visible.has(edge.toContactId))
        .map((edge) => ({ contactId: edge.toContactId, type: edge.type })),
    })),
  }
}

export async function listPluginRecords(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireMembership(db, userId, workspaceId)
  allow(plugin, 'data:own')
  const collection = collectionName(args.collection)
  const offset = pageOffset(args.offset)
  const where = and(eq(pluginDocuments.workspaceId, workspaceId), eq(pluginDocuments.pluginId, pluginId), eq(pluginDocuments.collection, collection), isNull(pluginDocuments.deletedAt))
  const counted = await db.select({ total: sql<number>`count(*)::int` }).from(pluginDocuments).where(where)
  const total = counted[0]?.total ?? 0
  const rows = await db.select().from(pluginDocuments).where(where).orderBy(asc(pluginDocuments.documentKey)).limit(100).offset(offset)
  return { total: Number(total), records: rows.map((row) => ({ id: row.documentKey, body: row.body, updatedAt: row.updatedAt.toISOString() })) }
}

export async function getPluginRecord(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireMembership(db, userId, workspaceId)
  allow(plugin, 'data:own')
  const collection = collectionName(args.collection)
  const id = recordId(args.id)
  const [row] = await db
    .select()
    .from(pluginDocuments)
    .where(and(eq(pluginDocuments.workspaceId, workspaceId), eq(pluginDocuments.pluginId, pluginId), eq(pluginDocuments.collection, collection), eq(pluginDocuments.documentKey, id), isNull(pluginDocuments.deletedAt)))
    .limit(1)
  if (!row) throw new AppError(404, 'Record not found')
  return { id: row.documentKey, body: row.body, updatedAt: row.updatedAt.toISOString() }
}

export async function putPluginRecords(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireWriter(db, userId, workspaceId)
  allow(plugin, 'data:own')
  const collection = collectionName(args.collection)
  const entries = Array.isArray(args.records) ? args.records : [{ id: args.id, body: args.body }]
  if (!entries.length || entries.length > 50) throw new AppError(400, 'Save up to 50 records at a time')
  const saved = []
  for (const entry of entries) {
    const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    let body: Record<string, unknown>
    try {
      body = pluginDocumentBody(row.body)
    } catch (caught) {
      throw new AppError(400, caught instanceof Error ? caught.message : 'A record is an object')
    }
    const id = typeof row.id === 'string' && row.id ? recordId(row.id) : randomUUID()
    const [existing] = await db
      .select({ id: pluginDocuments.id })
      .from(pluginDocuments)
      .where(and(eq(pluginDocuments.workspaceId, workspaceId), eq(pluginDocuments.pluginId, pluginId), eq(pluginDocuments.collection, collection), eq(pluginDocuments.documentKey, id)))
      .limit(1)
    if (existing) {
      await db.update(pluginDocuments).set({ body, deletedAt: null, updatedAt: new Date() }).where(eq(pluginDocuments.id, existing.id))
    } else {
      await db.insert(pluginDocuments).values({ workspaceId, pluginId, collection, documentKey: id, body })
    }
    saved.push({ id, body })
  }
  return entries.length === 1 && !Array.isArray(args.records) ? saved[0] : { records: saved }
}

export async function removePluginRecord(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireWriter(db, userId, workspaceId)
  allow(plugin, 'data:own')
  const collection = collectionName(args.collection)
  const id = recordId(args.id)
  const [row] = await db
    .update(pluginDocuments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pluginDocuments.workspaceId, workspaceId), eq(pluginDocuments.pluginId, pluginId), eq(pluginDocuments.collection, collection), eq(pluginDocuments.documentKey, id), isNull(pluginDocuments.deletedAt)))
    .returning({ id: pluginDocuments.id })
  if (!row) throw new AppError(404, 'Record not found')
  return { ok: true }
}

export async function putPluginFile(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireWriter(db, userId, workspaceId)
  allow(plugin, 'files:own')
  let file: ReturnType<typeof pluginFilePayload>
  try {
    file = pluginFilePayload(args)
  } catch (caught) {
    throw new AppError(400, caught instanceof Error ? caught.message : 'Choose a file')
  }
  const bytes = Buffer.from(file.data, 'base64')
  if (!bytes.length || bytes.length > 4_000_000) throw new AppError(400, 'Keep an export under 4 MB')
  const [row] = await db.insert(pluginFiles).values({ workspaceId, pluginId, filename: file.filename, contentType: file.contentType, content: file.data }).returning({ id: pluginFiles.id, filename: pluginFiles.filename })
  if (!row) throw new AppError(500, 'Could not store the file')
  return row
}

export async function listPluginFiles(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted) {
  await requireMembership(db, userId, workspaceId)
  allow(plugin, 'files:own')
  const rows = await db
    .select({ id: pluginFiles.id, filename: pluginFiles.filename, contentType: pluginFiles.contentType, createdAt: pluginFiles.createdAt })
    .from(pluginFiles)
    .where(and(eq(pluginFiles.workspaceId, workspaceId), eq(pluginFiles.pluginId, pluginId)))
    .orderBy(asc(pluginFiles.createdAt))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function readPluginFile(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, fileId: string) {
  await requireMembership(db, userId, workspaceId)
  allow(plugin, 'files:own')
  const [row] = await db
    .select()
    .from(pluginFiles)
    .where(and(eq(pluginFiles.id, fileId), eq(pluginFiles.workspaceId, workspaceId), eq(pluginFiles.pluginId, pluginId)))
    .limit(1)
  if (!row) throw new AppError(404, 'File not found')
  return row
}

export async function removePluginFile(db: Database, userId: string, workspaceId: string, pluginId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireWriter(db, userId, workspaceId)
  allow(plugin, 'files:own')
  const fileId = typeof args.id === 'string' ? args.id : ''
  const [row] = await db
    .delete(pluginFiles)
    .where(and(eq(pluginFiles.id, fileId), eq(pluginFiles.workspaceId, workspaceId), eq(pluginFiles.pluginId, pluginId)))
    .returning({ id: pluginFiles.id })
  if (!row) throw new AppError(404, 'File not found')
  return { ok: true }
}

export async function suggestForPlugin(db: Database, userId: string, workspaceId: string, plugin: Granted, args: Record<string, unknown>) {
  await requireWriter(db, userId, workspaceId)
  allow(plugin, 'ai:suggest')
  return suggestPluginText(db, workspaceId, args.prompt)
}
