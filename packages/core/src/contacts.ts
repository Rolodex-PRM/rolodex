import { createHash, randomUUID } from 'node:crypto'
import {
  addressBookChanges,
  addressBooks,
  addresses,
  auditLogs,
  contactDates,
  contactGrants,
  contactGroupGrants,
  contactMethods,
  contactResources,
  contactTags,
  contacts,
  tags,
  userGroupMembers,
  userGroups,
  userRelationships,
  users,
  workspaceMembers,
  type ContactGrantRole,
  type ContactType,
  type Database,
  type WorkspaceRole,
} from '@rolodex/db'
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { requireBook, requireManager, requireMembership, requireWriter, type Db } from './access'
import { AppError } from './errors'
import { trashPolicy } from './trash'
import { emptyToNull, isUuid, normalizeEmail, normalizePhone } from './normalize'
import { decideContactAccess } from './permissions'
import { etagMatches, makeEtag } from './secrets'
import { cardDisplayName, parseVcards, serializeVcard, structuredName, type ParsedCard } from './vcard'
import { contactDateSchema, contactSchema } from './validation'

export type ContactBody = z.infer<typeof contactSchema>

type Bundle = Awaited<ReturnType<typeof loadBundle>>

export function displayNameOf(input: ContactBody) {
  const preferred = input.preferredName?.trim()
  const last = input.lastName?.trim()
  const core = preferred
    ? [preferred, last].filter((part): part is string => Boolean(part))
    : [input.firstName, input.middleName, input.lastName]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
  const parts = [input.prefix?.trim(), ...core, input.suffix?.trim()].filter((part): part is string => Boolean(part))
  if (parts.length) return parts.join(' ')
  if (input.organizationName?.trim()) return input.organizationName.trim()
  return 'Unnamed'
}

export async function listContacts(
  db: Database,
  userId: string,
  workspaceId: string,
  query: { q?: string | undefined; addressBookId?: string | undefined; limit?: number | undefined; offset?: number | undefined; city?: string | undefined; organization?: string | undefined; relationship?: string | undefined; tag?: string | undefined; birthdayMonth?: number | undefined; quietDays?: number | undefined },
) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  const offset = Math.max(query.offset ?? 0, 0)
  const filters = [eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)]
  if (query.addressBookId) {
    const { book } = await requireBook(db, userId, query.addressBookId)
    if (book.workspaceId !== workspaceId) throw new AppError(404, 'Address book not found')
    filters.push(
      sql`exists (select 1 from contact_resources r where r.contact_id = ${contacts.id} and r.address_book_id = ${book.id} and r.deleted_at is null)`,
    )
  } else {
    await requireMembership(db, userId, workspaceId)
  }
  const q = query.q?.trim()
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, '')}%`
    const tsQuery = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim()
    const search = [
      ilike(contacts.displayName, pattern),
      ilike(contacts.organizationName, pattern),
      ilike(contacts.cardNote, pattern),
      sql`exists (select 1 from contact_methods m where m.contact_id = ${contacts.id} and (m.value ilike ${pattern} or m.normalized_value ilike ${pattern}))`,
      sql`exists (select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = ${contacts.id} and t.name ilike ${pattern})`,
      sql`exists (select 1 from organization_memberships om join organizations o on o.id = om.organization_id where om.contact_id = ${contacts.id} and o.deleted_at is null and o.name ilike ${pattern})`,
      sql`exists (select 1 from relationships r where r.workspace_id = ${workspaceId} and (r.from_contact_id = ${contacts.id} or r.to_contact_id = ${contacts.id}) and (r.type ilike ${pattern} or r.category ilike ${pattern}))`,
      sql`exists (select 1 from notes n where n.contact_id = ${contacts.id} and n.deleted_at is null and n.body ilike ${pattern} and (n.visibility = 'workspace' or n.author_id = ${userId}))`,
      sql`exists (select 1 from activity_contacts ac join activities a on a.id = ac.activity_id where ac.contact_id = ${contacts.id} and a.deleted_at is null and (coalesce(a.description, '') ilike ${pattern} or a.type ilike ${pattern}) and (a.visibility = 'workspace' or a.created_by = ${userId}))`,
      sql`exists (select 1 from tasks t where t.contact_id = ${contacts.id} and t.deleted_at is null and t.title ilike ${pattern})`,
    ]
    if (/^birthdays?$/i.test(q)) {
      search.push(sql`${contacts.birthday} is not null and extract(month from ${contacts.birthday}) = extract(month from current_date)`)
    }
    if (tsQuery) {
      search.push(
        sql`to_tsvector('english', coalesce(${contacts.displayName}, '') || ' ' || coalesce(${contacts.organizationName}, '') || ' ' || coalesce(${contacts.cardNote}, '')) @@ plainto_tsquery('english', ${tsQuery})`,
      )
    }
    const combined = or(...search)
    if (combined) filters.push(combined)
  }
  const like = (value?: string) => {
    const text = value?.trim()
    return text ? `%${text.replace(/[%_]/g, '')}%` : ''
  }
  if (like(query.city)) filters.push(sql`exists (select 1 from addresses a where a.contact_id = ${contacts.id} and a.city ilike ${like(query.city)})`)
  if (like(query.organization)) {
    const pattern = like(query.organization)
    filters.push(sql`(${contacts.organizationName} ilike ${pattern} or exists (select 1 from organization_memberships om join organizations o on o.id = om.organization_id where om.contact_id = ${contacts.id} and o.deleted_at is null and o.name ilike ${pattern}))`)
  }
  if (like(query.relationship)) filters.push(sql`exists (select 1 from relationships r where r.workspace_id = ${workspaceId} and (r.from_contact_id = ${contacts.id} or r.to_contact_id = ${contacts.id}) and r.type ilike ${like(query.relationship)})`)
  if (like(query.tag)) filters.push(sql`exists (select 1 from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = ${contacts.id} and t.name ilike ${like(query.tag)})`)
  if (query.birthdayMonth && query.birthdayMonth >= 1 && query.birthdayMonth <= 12) filters.push(sql`extract(month from ${contacts.birthday}) = ${query.birthdayMonth}`)
  if (query.quietDays && query.quietDays > 0) {
    const days = Math.min(Math.round(query.quietDays), 3650)
    filters.push(sql`(${contacts.lastInteractionAt} is null or ${contacts.lastInteractionAt} < now() - make_interval(days => ${days}))`)
  }
  const where = and(...filters)
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(where)
  const rows = await db
    .select()
    .from(contacts)
    .where(where)
    .orderBy(asc(contacts.displayName))
    .limit(limit)
    .offset(offset)
  const ids = rows.map((row) => row.id)
  const methodRows = ids.length
    ? await db.select().from(contactMethods).where(inArray(contactMethods.contactId, ids)).orderBy(contactMethods.sortOrder)
    : []
  const tagRows = ids.length
    ? await db
        .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(inArray(contactTags.contactId, ids))
    : []
  const bookRows = ids.length
    ? await db
        .select({ contactId: contactResources.contactId, id: addressBooks.id, name: addressBooks.name })
        .from(contactResources)
        .innerJoin(addressBooks, eq(addressBooks.id, contactResources.addressBookId))
        .where(and(inArray(contactResources.contactId, ids), isNull(contactResources.deletedAt), isNull(addressBooks.deletedAt)))
    : []
  const addressRows = ids.length
    ? await db.select().from(addresses).where(inArray(addresses.contactId, ids)).orderBy(asc(addresses.sortOrder))
    : []
  const firstAddress = new Map<string, (typeof addressRows)[number]>()
  for (const address of addressRows) {
    if (!firstAddress.has(address.contactId)) firstAddress.set(address.contactId, address)
  }
  return {
    total: countRow?.total ?? 0,
    contacts: rows.map((row) => {
      const methods = methodRows.filter((method) => method.contactId === row.id)
      const email = methods.find((method) => method.kind === 'email' && method.isPrimary) ?? methods.find((method) => method.kind === 'email')
      const phone = methods.find((method) => method.kind === 'phone' && method.isPrimary) ?? methods.find((method) => method.kind === 'phone')
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        displayName: row.displayName,
        organizationName: row.organizationName,
        title: row.title,
        primaryEmail: email?.value ?? null,
        primaryPhone: phone?.value ?? null,
        updatedAt: row.updatedAt.toISOString(),
        hasPhoto: Boolean(row.photoAttachmentId),
        street: firstAddress.get(row.id)?.street || null,
        city: firstAddress.get(row.id)?.city || null,
        region: firstAddress.get(row.id)?.region || null,
        postalCode: firstAddress.get(row.id)?.postalCode || null,
        country: firstAddress.get(row.id)?.country || null,
        lat: firstAddress.get(row.id)?.latitude ?? null,
        lon: firstAddress.get(row.id)?.longitude ?? null,
        visibility: row.visibility,
        tags: tagRows.filter((tag) => tag.contactId === row.id).map((tag) => ({ id: tag.id, name: tag.name })),
        addressBooks: bookRows.filter((book) => book.contactId === row.id).map((book) => ({ id: book.id, name: book.name })),
      }
    }),
  }
}

export async function locateContact(db: Database, userId: string, workspaceId: string, contactId: string, lat: number, lon: number) {
  await requireContactWrite(db, userId, workspaceId, contactId)
  const [address] = await db.select().from(addresses).where(eq(addresses.contactId, contactId)).orderBy(asc(addresses.sortOrder)).limit(1)
  if (!address) throw new AppError(404, 'This contact has no address')
  await db.update(addresses).set({ latitude: lat, longitude: lon }).where(eq(addresses.id, address.id))
  return { ok: true }
}

export async function getContact(db: Database, userId: string, workspaceId: string, contactId: string) {
  const bundle = await loadBundle(db, contactId)
  await assertCanReadContact(db, userId, workspaceId, bundle)
  return withUserRelationship(db, userId, workspaceId, contactId, presentContact(bundle))
}

export async function createContact(db: Database, userId: string, workspaceId: string, input: ContactBody) {
  await requireWriter(db, userId, workspaceId)
  const bookIds = await writableBookIds(db, userId, workspaceId, input)
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const contactId = await insertContact(database, {
      workspaceId,
      ownerId: userId,
      input,
      bookId: bookIds[0]!,
      bookIds,
    })
    await recordAudit(database, workspaceId, userId, 'contact.create', contactId)
    return presentContact(await loadBundle(database, contactId))
  })
}

export async function updateContact(
  db: Database,
  userId: string,
  workspaceId: string,
  contactId: string,
  input: ContactBody,
) {
  const existingAccess = await loadBundle(db, contactId)
  await assertCanWriteContact(db, userId, workspaceId, existingAccess)
  const bookIds = input.addressBookIds ? await writableBookIds(db, userId, workspaceId, input) : undefined
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const existing = await loadBundle(database, contactId)
    if (existing.contact.workspaceId !== workspaceId) throw new AppError(404, 'Contact not found')
    const merged = mergeContact(input, existing.contact)
    if (merged.introducedByContactId) {
      await assertSameWorkspaceContact(database, workspaceId, merged.introducedByContactId, contactId)
    }
    const tagIds = await resolveTags(database, workspaceId, input.tagIds, input.tagNames)
    await database
      .update(contacts)
      .set({ ...identityValues(merged, existing.contact.type), updatedAt: new Date() })
      .where(eq(contacts.id, contactId))
    if (input.methods) await replaceMethods(database, contactId, input.methods)
    if (input.addresses) await replaceAddresses(database, contactId, input.addresses)
    if (input.tagIds || input.tagNames) await replaceTags(database, contactId, tagIds)
    await syncResources(database, contactId, bookIds ? { bookIds } : undefined)
    await recordAudit(database, workspaceId, userId, 'contact.update', contactId)
    return presentContact(await loadBundle(database, contactId))
  })
}

export async function deleteContact(db: Database, userId: string, workspaceId: string, contactId: string) {
  await assertCanWriteContact(db, userId, workspaceId, await loadBundle(db, contactId))
  await db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const existing = await loadBundle(database, contactId)
    if (existing.contact.workspaceId !== workspaceId) throw new AppError(404, 'Contact not found')
    await database.update(contacts).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contacts.id, contactId))
    await syncResources(database, contactId, { deleted: true })
    await recordAudit(database, workspaceId, userId, 'contact.delete', contactId)
  })
}

export async function listDeletedContacts(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const policy = await trashPolicy(db)
  await purgeDeletedContacts(db, workspaceId, new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000))
  const rows = await db
    .select({ id: contacts.id, displayName: contacts.displayName, deletedAt: contacts.deletedAt })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), sql`${contacts.deletedAt} is not null`, visibleContactSql(userId)))
    .orderBy(desc(contacts.deletedAt))
    .limit(200)
  return {
    retentionDays: policy.retentionDays,
    contacts: rows.map((row) => ({ id: row.id, displayName: row.displayName, deletedAt: row.deletedAt?.toISOString() ?? null })),
  }
}

export async function restoreContact(db: Database, userId: string, workspaceId: string, contactId: string) {
  const bundle = await loadBundle(db, contactId, { deleted: true })
  if (bundle.contact.workspaceId !== workspaceId) throw new AppError(404, 'Contact not found')
  await assertCanWriteContact(db, userId, workspaceId, bundle)
  await db.update(contacts).set({ deletedAt: null, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  await syncResources(db, contactId)
  await recordAudit(db, workspaceId, userId, 'contact.restore', contactId)
  return { ok: true }
}

export async function emptyTrash(db: Database, userId: string, workspaceId: string) {
  await requireWriter(db, userId, workspaceId)
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), sql`${contacts.deletedAt} is not null`, visibleContactSql(userId)))
  if (!rows.length) return { removed: 0 }
  await db.delete(contacts).where(inArray(contacts.id, rows.map((row) => row.id)))
  return { removed: rows.length }
}

async function purgeDeletedContacts(db: Database, workspaceId: string, olderThan: Date) {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), sql`${contacts.deletedAt} is not null`, lt(contacts.deletedAt, olderThan)))
  if (!rows.length) return 0
  await db.delete(contacts).where(inArray(contacts.id, rows.map((row) => row.id)))
  return rows.length
}

export async function setContactPhoto(db: Database, userId: string, workspaceId: string, contactId: string, attachmentId: string | null) {
  const bundle = await loadBundle(db, contactId)
  await assertCanWriteContact(db, userId, workspaceId, bundle)
  await db.update(contacts).set({ photoAttachmentId: attachmentId, updatedAt: new Date() }).where(eq(contacts.id, contactId))
}

export async function setContactCover(db: Database, userId: string, workspaceId: string, contactId: string, attachmentId: string | null) {
  const bundle = await loadBundle(db, contactId)
  await assertCanWriteContact(db, userId, workspaceId, bundle)
  await db
    .update(contacts)
    .set({ coverAttachmentId: attachmentId, coverMode: attachmentId ? 'image' : 'cycle', updatedAt: new Date() })
    .where(eq(contacts.id, contactId))
}

export async function setContactCoverMode(db: Database, userId: string, workspaceId: string, contactId: string, mode: 'image' | 'cycle') {
  const bundle = await loadBundle(db, contactId)
  await assertCanWriteContact(db, userId, workspaceId, bundle)
  if (mode === 'image' && !bundle.contact.coverAttachmentId) throw new AppError(400, 'Choose a cover photo first')
  await db.update(contacts).set({ coverMode: mode, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  return getContact(db, userId, workspaceId, contactId)
}

export async function listTags(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  return db.select().from(tags).where(eq(tags.workspaceId, workspaceId)).orderBy(asc(tags.name))
}

export async function createTag(db: Database, userId: string, workspaceId: string, name: string, color?: string | null) {
  await requireWriter(db, userId, workspaceId)
  return findOrCreateTag(db, workspaceId, name, color)
}

export async function upsertFromVCard(
  db: Database,
  input: { userId: string; bookId: string; uid: string; vcardText: string; ifMatch?: string | null },
) {
  const { book } = await requireBook(db, input.userId, input.bookId, true)
  const [card] = parseVcards(input.vcardText)
  if (!card) throw new AppError(400, 'A vCard is required')
  card.uid = input.uid
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const [existing] = await database
      .select()
      .from(contactResources)
      .where(and(eq(contactResources.addressBookId, book.id), eq(contactResources.uid, input.uid)))
      .limit(1)
    if (existing && !existing.deletedAt) {
      if (!input.ifMatch) throw new AppError(412, 'If-Match is required to update a contact')
      if (!etagMatches(input.ifMatch, existing.etag)) throw new AppError(412, 'The contact was changed somewhere else')
      await applyCard(database, existing.contactId, card)
      const synced = await syncResources(database, existing.contactId, { unknown: card.unknown, uid: input.uid })
      await recordAudit(database, book.workspaceId, input.userId, 'contact.update', existing.contactId)
      return { etag: synced.etag, created: false }
    }
    if (existing?.deletedAt) {
      await database.update(contacts).set({ deletedAt: null, updatedAt: new Date() }).where(eq(contacts.id, existing.contactId))
      await applyCard(database, existing.contactId, card)
      const synced = await syncResources(database, existing.contactId, { unknown: card.unknown, uid: input.uid })
      await recordAudit(database, book.workspaceId, input.userId, 'contact.create', existing.contactId)
      return { etag: synced.etag, created: true }
    }
    const createdId = await insertContact(database, {
      workspaceId: book.workspaceId,
      ownerId: input.userId,
      input: cardToInput(card),
      bookId: book.id,
      uid: input.uid,
      unknown: card.unknown,
    })
    const synced = await loadBundle(database, createdId)
    await recordAudit(database, book.workspaceId, input.userId, 'contact.create', createdId)
    return { etag: synced.resource?.etag ?? '', created: true }
  })
}

export async function deleteCard(db: Database, userId: string, bookId: string, uid: string) {
  const { book } = await requireBook(db, userId, bookId, true)
  await db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const [existing] = await database
      .select()
      .from(contactResources)
      .where(and(eq(contactResources.addressBookId, book.id), eq(contactResources.uid, uid), isNull(contactResources.deletedAt)))
      .limit(1)
    if (!existing) throw new AppError(404, 'Contact not found')
    await database.update(contacts).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(contacts.id, existing.contactId))
    await syncResources(database, existing.contactId, { deleted: true })
    await recordAudit(database, book.workspaceId, userId, 'contact.delete', existing.contactId)
  })
}

export async function getLiveCard(db: Database, userId: string, bookId: string, uid: string) {
  const { book, role } = await requireBook(db, userId, bookId)
  const [resource] = await db
    .select()
    .from(contactResources)
    .where(and(eq(contactResources.addressBookId, book.id), eq(contactResources.uid, uid), isNull(contactResources.deletedAt)))
    .limit(1)
  if (!resource) throw new AppError(404, 'Contact not found')
  const readable = await readableContactIds(db, userId, role, [resource.contactId])
  if (!readable.has(resource.contactId)) throw new AppError(404, 'Contact not found')
  return resource
}

export async function listLiveCards(db: Database, userId: string, bookId: string) {
  const { book, role } = await requireBook(db, userId, bookId)
  const rows = await db
    .select()
    .from(contactResources)
    .where(and(eq(contactResources.addressBookId, book.id), isNull(contactResources.deletedAt)))
    .orderBy(asc(contactResources.uid))
  const readable = await readableContactIds(db, userId, role, rows.map((row) => row.contactId))
  return rows.filter((row) => readable.has(row.contactId))
}

export async function syncCollection(db: Database, userId: string, bookId: string, token: number | null) {
  const { book, role } = await requireBook(db, userId, bookId)
  if (token !== null && (!Number.isInteger(token) || token < 0 || token > book.syncToken)) {
    throw new AppError(409, 'Sync token is no longer valid')
  }
  if (token === null) {
    const rows = await listLiveCards(db, userId, book.id)
    return {
      token: book.syncToken,
      changes: rows.map((row) => ({ uid: row.uid, deleted: false, etag: row.etag, vcard: row.vcardText })),
    }
  }
  const changes = await db
    .select()
    .from(addressBookChanges)
    .where(and(eq(addressBookChanges.addressBookId, book.id), sql`${addressBookChanges.syncToken} > ${token}`))
    .orderBy(asc(addressBookChanges.syncToken))
  const latest = new Map<string, (typeof changes)[number]>()
  for (const change of changes) latest.set(change.uid, change)
  const liveIds = [...latest.values()].filter((change) => !change.deleted).map((change) => change.uid)
  const live = liveIds.length
    ? await db
        .select()
        .from(contactResources)
        .where(
          and(eq(contactResources.addressBookId, book.id), inArray(contactResources.uid, liveIds), isNull(contactResources.deletedAt)),
        )
    : []
  const liveByUid = new Map(live.map((row) => [row.uid, row]))
  const readable = await readableContactIds(db, userId, role, live.map((row) => row.contactId))
  return {
    token: book.syncToken,
    changes: [...latest.values()].map((change) => {
      const resource = liveByUid.get(change.uid)
      if (!resource || change.deleted || !readable.has(resource.contactId)) return { uid: change.uid, deleted: true, etag: null, vcard: null }
      return { uid: change.uid, deleted: false, etag: resource.etag, vcard: resource.vcardText }
    }),
  }
}

export async function findDuplicates(db: Database, workspaceId: string, emails: string[], phones: string[]) {
  const matches = new Map<string, { id: string; displayName: string; reason: 'email' | 'phone' }>()
  if (emails.length) {
    const rows = await db
      .select({ id: contacts.id, displayName: contacts.displayName })
      .from(contactMethods)
      .innerJoin(contacts, eq(contacts.id, contactMethods.contactId))
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          isNull(contacts.deletedAt),
          eq(contactMethods.kind, 'email'),
          inArray(contactMethods.normalizedValue, emails),
        ),
      )
    for (const row of rows) matches.set(row.id, { ...row, reason: 'email' })
  }
  if (phones.length) {
    const rows = await db
      .select({ id: contacts.id, displayName: contacts.displayName })
      .from(contactMethods)
      .innerJoin(contacts, eq(contacts.id, contactMethods.contactId))
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          isNull(contacts.deletedAt),
          eq(contactMethods.kind, 'phone'),
          inArray(contactMethods.normalizedValue, phones),
        ),
      )
    for (const row of rows) {
      if (!matches.has(row.id)) matches.set(row.id, { ...row, reason: 'phone' })
    }
  }
  return [...matches.values()]
}

export function cardFingerprint(card: ParsedCard) {
  const emails = card.emails.map((entry) => normalizeEmail(entry.value)).filter(Boolean).sort()
  const phones = card.phones.map((entry) => normalizePhone(entry.value)).filter(Boolean).sort()
  const basis = [card.uid ?? '', cardDisplayName(card), emails.join(','), phones.join(',')].join('|')
  return createHash('sha256').update(basis).digest('hex').slice(0, 20)
}

export async function createContactFromCard(db: Database, userId: string, bookId: string, card: ParsedCard) {
  const { book } = await requireBook(db, userId, bookId, true)
  return db.transaction(async (tx) => {
    const database = tx as unknown as Database
    const contactId = await insertContact(database, {
      workspaceId: book.workspaceId,
      ownerId: userId,
      input: cardToInput(card),
      bookId: book.id,
      uid: card.uid,
      unknown: card.unknown,
    })
    return contactId
  })
}

async function resolveBook(db: Database, userId: string, workspaceId: string, addressBookId?: string) {
  if (addressBookId) {
    const { book } = await requireBook(db, userId, addressBookId, true)
    if (book.workspaceId !== workspaceId) throw new AppError(404, 'Address book not found')
    return book
  }
  const [book] = await db
    .select()
    .from(addressBooks)
    .where(and(eq(addressBooks.workspaceId, workspaceId), isNull(addressBooks.deletedAt)))
    .orderBy(asc(addressBooks.createdAt))
    .limit(1)
  if (!book) throw new AppError(400, 'Create an address book before adding contacts')
  return book
}

async function writableBookIds(db: Database, userId: string, workspaceId: string, input: ContactBody) {
  const requested = [...new Set([...(input.addressBookIds ?? []), ...(input.addressBookId ? [input.addressBookId] : [])])]
  if (input.addressBookIds && !requested.length) throw new AppError(400, 'Choose at least one address book')
  if (!requested.length) {
    const book = await resolveBook(db, userId, workspaceId)
    return [book.id]
  }
  for (const id of requested) {
    const { book } = await requireBook(db, userId, id, true)
    if (book.workspaceId !== workspaceId) throw new AppError(400, 'Choose address books from this workspace')
  }
  return requested
}

export function visibleContactSql(userId: string) {
  return sql`(
    ${contacts.visibility} <> 'restricted'
    or ${contacts.ownerId} = ${userId}
    or exists (select 1 from contact_grants g where g.contact_id = ${contacts.id} and g.user_id = ${userId})
    or exists (
      select 1 from contact_group_grants cg
      inner join user_group_members gm on gm.group_id = cg.group_id
      where cg.contact_id = ${contacts.id} and gm.user_id = ${userId}
    )
    or exists (select 1 from workspace_members wm where wm.workspace_id = ${contacts.workspaceId} and wm.user_id = ${userId} and wm.role in ('owner', 'administrator'))
  )`
}

async function accessFor(db: Database, userId: string, workspaceId: string, bundle: Bundle) {
  if (bundle.contact.workspaceId !== workspaceId) throw new AppError(404, 'Contact not found')
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)
  let bookRole: WorkspaceRole | null = null
  for (const book of bundle.books) {
    try {
      const result = await requireBook(db, userId, book.id)
      bookRole = result.role
      break
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
  }
  const [grant] = await db
    .select()
    .from(contactGrants)
    .where(and(eq(contactGrants.contactId, bundle.contact.id), eq(contactGrants.userId, userId)))
    .limit(1)
  const groupRoles = await db
    .select({ role: contactGroupGrants.role })
    .from(contactGroupGrants)
    .innerJoin(userGroupMembers, eq(userGroupMembers.groupId, contactGroupGrants.groupId))
    .where(and(eq(contactGroupGrants.contactId, bundle.contact.id), eq(userGroupMembers.userId, userId)))
  const grantRole = strongerGrant([grant?.role, ...groupRoles.map((row) => row.role)])
  return decideContactAccess({
    visibility: bundle.contact.visibility,
    ownerId: bundle.contact.ownerId,
    userId,
    workspaceRole: member?.role ?? null,
    grant: grantRole,
    bookRole,
  })
}

async function assertCanReadContact(db: Database, userId: string, workspaceId: string, bundle: Bundle) {
  const access = await accessFor(db, userId, workspaceId, bundle)
  if (!access.read) throw new AppError(404, 'Contact not found')
  return access
}

async function assertCanWriteContact(db: Database, userId: string, workspaceId: string, bundle: Bundle) {
  const access = await accessFor(db, userId, workspaceId, bundle)
  if (!access.read) throw new AppError(404, 'Contact not found')
  if (!access.write) throw new AppError(403, 'You do not have permission to edit contacts')
  return access
}

export async function requireContactWrite(db: Database, userId: string, workspaceId: string, contactId: string) {
  const bundle = await loadBundle(db, contactId)
  await assertCanWriteContact(db, userId, workspaceId, bundle)
}

async function requireContactManage(db: Database, userId: string, workspaceId: string, contactId: string) {
  const bundle = await loadBundle(db, contactId)
  const access = await assertCanReadContact(db, userId, workspaceId, bundle)
  if (!access.manage) throw new AppError(403, 'You do not have permission to change access')
  return bundle
}

async function insertContact(
  db: Db,
  args: {
    workspaceId: string
    ownerId: string
    input: ContactBody
    bookId: string
    bookIds?: string[] | undefined
    uid?: string | undefined
    unknown?: string[] | undefined
  },
) {
  if (args.input.introducedByContactId) {
    await assertSameWorkspaceContact(db, args.workspaceId, args.input.introducedByContactId)
  }
  const tagIds = await resolveTags(db, args.workspaceId, args.input.tagIds, args.input.tagNames)
  const [contact] = await db
    .insert(contacts)
    .values({
      workspaceId: args.workspaceId,
      ownerId: args.ownerId,
      ...identityValues(args.input, args.input.type ?? 'individual'),
    })
    .returning()
  if (!contact) throw new AppError(500, 'Could not create the contact')
  if (args.input.methods) await replaceMethods(db, contact.id, args.input.methods)
  if (args.input.addresses) await replaceAddresses(db, contact.id, args.input.addresses)
  if (tagIds.length) await replaceTags(db, contact.id, tagIds)
  await syncResources(db, contact.id, { bookId: args.bookId, bookIds: args.bookIds ?? [args.bookId], uid: args.uid, unknown: args.unknown })
  return contact.id
}

function cardToInput(card: ParsedCard): ContactBody {
  const name = structuredName(card)
  return {
    firstName: name.first || null,
    middleName: name.middle || null,
    lastName: name.last || null,
    prefix: name.prefix || null,
    suffix: name.suffix || null,
    nickname: card.nickname || null,
    organizationName: card.organization || null,
    department: card.department || null,
    title: card.title || null,
    position: card.position || null,
    website: card.url || null,
    cardNote: card.note || null,
    birthday: card.birthday || null,
    anniversary: card.anniversary || null,
    methods: [
      ...card.emails.map((entry) => ({ kind: 'email' as const, label: entry.label, value: entry.value })),
      ...card.phones.map((entry) => ({ kind: 'phone' as const, label: entry.label, value: entry.value })),
      ...card.socials.map((entry) => ({ kind: 'social' as const, label: entry.label, value: entry.value })),
    ],
    addresses: card.addresses.map((entry) => ({
      label: entry.label,
      street: entry.street,
      street2: entry.street2,
      city: entry.city,
      region: entry.region,
      postalCode: entry.postalCode,
      country: entry.country,
    })),
    tagNames: importTags(card.categories),
  }
}

function importTags(names: string[] | undefined) {
  const skip = new Set(['mycontacts', 'my contacts'])
  const seen = new Set<string>()
  const tags: string[] = []
  for (const name of names ?? []) {
    const trimmed = name.trim().slice(0, 40)
    const key = trimmed.toLowerCase()
    if (!trimmed || skip.has(key) || seen.has(key)) continue
    seen.add(key)
    tags.push(trimmed)
  }
  return tags
}

async function applyCard(db: Db, contactId: string, card: ParsedCard) {
  const input = cardToInput(card)
  await db
    .update(contacts)
    .set({
      prefix: emptyToNull(input.prefix),
      firstName: emptyToNull(input.firstName),
      middleName: emptyToNull(input.middleName),
      lastName: emptyToNull(input.lastName),
      suffix: emptyToNull(input.suffix),
      nickname: emptyToNull(input.nickname),
      displayName: cardDisplayName(card),
      organizationName: emptyToNull(input.organizationName),
      department: emptyToNull(input.department),
      title: emptyToNull(input.title),
      position: emptyToNull(input.position),
      website: emptyToNull(input.website),
      cardNote: emptyToNull(input.cardNote),
      birthday: input.birthday ?? null,
      anniversary: input.anniversary ?? null,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contactId))
  await db
    .delete(contactMethods)
    .where(and(eq(contactMethods.contactId, contactId), inArray(contactMethods.kind, ['email', 'phone', 'social'])))
  const methods = (input.methods ?? []).filter((method) => method.kind === 'email' || method.kind === 'phone' || method.kind === 'social')
  if (methods.length) await insertMethods(db, contactId, methods, 0)
  await replaceAddresses(db, contactId, input.addresses ?? [])
}

function mergeContact(input: ContactBody, current: typeof contacts.$inferSelect): ContactBody {
  const keep = <T>(value: T | null | undefined, previous: T | null) => (value === undefined ? previous : value)
  return {
    type: input.type ?? current.type,
    prefix: keep(input.prefix, current.prefix),
    firstName: keep(input.firstName, current.firstName),
    middleName: keep(input.middleName, current.middleName),
    lastName: keep(input.lastName, current.lastName),
    suffix: keep(input.suffix, current.suffix),
    preferredName: keep(input.preferredName, current.preferredName),
    nickname: keep(input.nickname, current.nickname),
    organizationName: keep(input.organizationName, current.organizationName),
    department: keep(input.department, current.department),
    title: keep(input.title, current.title),
    position: keep(input.position, current.position),
    birthday: keep(input.birthday, current.birthday),
    anniversary: keep(input.anniversary, current.anniversary),
    website: keep(input.website, current.website),
    cardNote: keep(input.cardNote, current.cardNote),
    howWeMet: keep(input.howWeMet, current.howWeMet),
    introducedByContactId: keep(input.introducedByContactId, current.introducedByContactId),
    preferredCommunication: keep(input.preferredCommunication, current.preferredCommunication),
    interests: keep(input.interests, current.interests),
    personalDetails: keep(input.personalDetails, current.personalDetails),
    professionalBackground: keep(input.professionalBackground, current.professionalBackground),
    followUpFrequency: keep(input.followUpFrequency, current.followUpFrequency),
    methods: input.methods,
    addresses: input.addresses,
    tagIds: input.tagIds,
    tagNames: input.tagNames,
  }
}

function identityValues(input: ContactBody, fallbackType: ContactType) {
  return {
    type: input.type ?? fallbackType,
    prefix: emptyToNull(input.prefix),
    firstName: emptyToNull(input.firstName),
    middleName: emptyToNull(input.middleName),
    lastName: emptyToNull(input.lastName),
    suffix: emptyToNull(input.suffix),
    preferredName: emptyToNull(input.preferredName),
    nickname: emptyToNull(input.nickname),
    displayName: displayNameOf(input),
    organizationName: emptyToNull(input.organizationName),
    department: emptyToNull(input.department),
    title: emptyToNull(input.title),
    position: emptyToNull(input.position),
    birthday: input.birthday ?? null,
    anniversary: input.anniversary ?? null,
    website: emptyToNull(input.website),
    cardNote: emptyToNull(input.cardNote),
    howWeMet: emptyToNull(input.howWeMet),
    introducedByContactId: input.introducedByContactId ?? null,
    preferredCommunication: emptyToNull(input.preferredCommunication),
    interests: emptyToNull(input.interests),
    personalDetails: emptyToNull(input.personalDetails),
    professionalBackground: emptyToNull(input.professionalBackground),
    followUpFrequency: emptyToNull(input.followUpFrequency),
  }
}

async function replaceMethods(db: Db, contactId: string, methods: NonNullable<ContactBody['methods']>) {
  await db.delete(contactMethods).where(eq(contactMethods.contactId, contactId))
  if (methods.length) await insertMethods(db, contactId, methods, 0)
}

async function insertMethods(db: Db, contactId: string, methods: NonNullable<ContactBody['methods']>, start: number) {
  const values = methods
    .map((method, index) => {
      const value = method.value.trim()
      const normalizedValue =
        method.kind === 'email' ? normalizeEmail(value) : method.kind === 'phone' ? normalizePhone(value) : value.toLowerCase()
      return { method, value, normalizedValue, index: start + index }
    })
    .filter((entry) => entry.normalizedValue)
  if (!values.length) return
  await db.insert(contactMethods).values(
    values.map((entry) => ({
      contactId,
      kind: entry.method.kind,
      label: entry.method.label?.trim() || defaultLabel(entry.method.kind),
      value: entry.value,
      normalizedValue: entry.normalizedValue,
      isPrimary: entry.method.isPrimary ?? entry.index === start,
      sortOrder: entry.index,
    })),
  )
}

function defaultLabel(kind: string) {
  if (kind === 'email') return 'other'
  if (kind === 'phone') return 'mobile'
  return ''
}

async function withUserRelationship<T extends object>(db: Db, userId: string, workspaceId: string, contactId: string, contact: T) {
  const [link] = await db
    .select({ type: userRelationships.type })
    .from(userRelationships)
    .where(and(eq(userRelationships.workspaceId, workspaceId), eq(userRelationships.userId, userId), eq(userRelationships.contactId, contactId)))
    .limit(1)
  return { ...contact, userRelationship: link?.type ?? null }
}

async function replaceAddresses(db: Db, contactId: string, rows: NonNullable<ContactBody['addresses']>) {
  await db.delete(addresses).where(eq(addresses.contactId, contactId))
  if (!rows.length) return
  await db.insert(addresses).values(
    rows.map((row, index) => ({
      contactId,
      label: row.label?.trim() || 'home',
      street: row.street?.trim() || '',
      street2: row.street2?.trim() || '',
      city: row.city?.trim() || '',
      region: row.region?.trim() || '',
      postalCode: row.postalCode?.trim() || '',
      country: row.country?.trim() || '',
      latitude: row.lat ?? null,
      longitude: row.lon ?? null,
      sortOrder: index,
    })),
  )
}

async function replaceTags(db: Db, contactId: string, tagIds: string[]) {
  await db.delete(contactTags).where(eq(contactTags.contactId, contactId))
  if (!tagIds.length) return
  await db.insert(contactTags).values(tagIds.map((tagId) => ({ contactId, tagId })))
}

async function resolveTags(db: Db, workspaceId: string, tagIds?: string[], tagNames?: string[]) {
  const ids = new Set(tagIds ?? [])
  for (const name of tagNames ?? []) {
    const tag = await findOrCreateTag(db, workspaceId, name)
    ids.add(tag.id)
  }
  if (!ids.size) return []
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), inArray(tags.id, [...ids])))
  if (rows.length !== ids.size) throw new AppError(400, 'Unknown tag')
  return rows.map((row) => row.id)
}

async function findOrCreateTag(db: Db, workspaceId: string, name: string, color?: string | null) {
  const trimmed = name.trim()
  const [existing] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), ilike(tags.name, trimmed)))
    .limit(1)
  if (existing) return existing
  try {
    const [created] = await db
      .insert(tags)
      .values({ workspaceId, name: trimmed, color: color ?? null })
      .returning()
    if (!created) throw new AppError(500, 'Could not create the tag')
    return created
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const [again] = await db
      .select()
      .from(tags)
      .where(and(eq(tags.workspaceId, workspaceId), eq(tags.name, trimmed)))
      .limit(1)
    if (!again) throw error
    return again
  }
}

async function assertSameWorkspaceContact(db: Db, workspaceId: string, contactId: string, selfId?: string) {
  if (!isUuid(contactId)) throw new AppError(400, 'Invalid contact')
  if (selfId && contactId === selfId) throw new AppError(400, 'A contact cannot introduce itself')
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
    .limit(1)
  if (!row) throw new AppError(400, 'Introduced-by contact was not found')
}

async function loadBundle(db: Db, contactId: string, options?: { deleted?: boolean }) {
  if (!isUuid(contactId)) throw new AppError(400, 'Invalid contact')
  const deleted = options?.deleted ? sql`${contacts.deletedAt} is not null` : isNull(contacts.deletedAt)
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), deleted)).limit(1)
  if (!contact) throw new AppError(404, 'Contact not found')
  const methods = await db.select().from(contactMethods).where(eq(contactMethods.contactId, contactId)).orderBy(asc(contactMethods.sortOrder))
  const addressRows = await db.select().from(addresses).where(eq(addresses.contactId, contactId)).orderBy(asc(addresses.sortOrder))
  const tagRows = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tagId))
    .where(eq(contactTags.contactId, contactId))
    .orderBy(asc(tags.name))
  const resources = await db
    .select()
    .from(contactResources)
    .where(and(eq(contactResources.contactId, contactId), isNull(contactResources.deletedAt)))
    .orderBy(desc(contactResources.updatedAt))
  const bookRows = resources.length
    ? await db
        .select()
        .from(addressBooks)
        .where(and(inArray(addressBooks.id, resources.map((resource) => resource.addressBookId)), isNull(addressBooks.deletedAt)))
    : []
  const liveResources = resources.filter((resource) => bookRows.some((item) => item.id === resource.addressBookId))
  return { contact, methods, addresses: addressRows, tags: tagRows, resource: liveResources[0] ?? resources[0], book: bookRows[0], books: bookRows }
}

function presentContact(bundle: Bundle) {
  const { contact, methods, addresses: addressRows, tags: tagRows, resource, book, books } = bundle
  return {
    id: contact.id,
    workspaceId: contact.workspaceId,
    type: contact.type,
    prefix: contact.prefix,
    firstName: contact.firstName,
    middleName: contact.middleName,
    lastName: contact.lastName,
    suffix: contact.suffix,
    preferredName: contact.preferredName,
    nickname: contact.nickname,
    displayName: contact.displayName,
    organizationName: contact.organizationName,
    department: contact.department,
    title: contact.title,
    position: contact.position,
    birthday: contact.birthday,
    anniversary: contact.anniversary,
    website: contact.website,
    cardNote: contact.cardNote,
    howWeMet: contact.howWeMet,
    introducedByContactId: contact.introducedByContactId,
    preferredCommunication: contact.preferredCommunication,
    interests: contact.interests,
    personalDetails: contact.personalDetails,
    professionalBackground: contact.professionalBackground,
    followUpFrequency: contact.followUpFrequency,
    lastInteractionAt: contact.lastInteractionAt?.toISOString() ?? null,
    visibility: contact.visibility,
    ownerId: contact.ownerId,
    hasPhoto: Boolean(contact.photoAttachmentId),
    photoAttachmentId: contact.photoAttachmentId,
    hasCover: Boolean(contact.coverAttachmentId),
    coverAttachmentId: contact.coverAttachmentId,
    coverMode: contact.coverMode === 'image' ? 'image' : 'cycle',
    addressBookId: book?.id ?? null,
    addressBookName: book?.name ?? null,
    addressBooks: books.map((item) => ({ id: item.id, name: item.name })),
    uid: resource?.uid ?? null,
    etag: resource?.etag ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
    methods: methods.map((method) => ({
      id: method.id,
      kind: method.kind,
      label: method.label,
      value: method.value,
      isPrimary: method.isPrimary,
    })),
    addresses: addressRows.map((row) => ({
      id: row.id,
      label: row.label,
      street: row.street,
      street2: row.street2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      country: row.country,
      lat: row.latitude,
      lon: row.longitude,
    })),
    tags: tagRows,
  }
}

async function syncResources(
  db: Db,
  contactId: string,
  options?: { bookId?: string; bookIds?: string[]; uid?: string; unknown?: string[]; deleted?: boolean },
) {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1)
  if (!contact) throw new AppError(404, 'Contact not found')
  const methods = await db.select().from(contactMethods).where(eq(contactMethods.contactId, contactId)).orderBy(asc(contactMethods.sortOrder))
  const addressRows = await db.select().from(addresses).where(eq(addresses.contactId, contactId)).orderBy(asc(addresses.sortOrder))
  let resources = await db.select().from(contactResources).where(eq(contactResources.contactId, contactId))
  if (options?.bookIds?.length) {
    for (const bookId of options.bookIds) {
      if (resources.some((resource) => resource.addressBookId === bookId)) continue
      await db.insert(contactResources).values({
        contactId,
        addressBookId: bookId,
        uid: options.uid && bookId === options.bookId ? options.uid : randomUUID(),
        etag: 'pending',
        vcardText: '',
        unknownProperties: options.unknown ?? [],
      })
    }
    resources = await db.select().from(contactResources).where(eq(contactResources.contactId, contactId))
  } else if (!resources.length) {
    if (!options?.bookId) throw new AppError(500, 'Contact is missing an address book')
    const uid = options.uid ?? randomUUID()
    await db.insert(contactResources).values({
      contactId,
      addressBookId: options.bookId,
      uid,
      etag: 'pending',
      vcardText: '',
      unknownProperties: options.unknown ?? [],
    })
    resources = await db.select().from(contactResources).where(eq(contactResources.contactId, contactId))
  }
  const bookIds = [...new Set(resources.map((resource) => resource.addressBookId))].sort()
  let primary: { etag: string; uid: string } | undefined
  for (const bookId of bookIds) {
    const [book] = await db.select().from(addressBooks).where(eq(addressBooks.id, bookId)).for('update').limit(1)
    if (!book) continue
    const bookResources = resources.filter((resource) => resource.addressBookId === bookId)
    for (const resource of bookResources) {
      const uid = options?.uid && resource.addressBookId === options.bookId ? options.uid : resource.uid
      const unknown = options?.unknown && (resource.uid === uid || resource.addressBookId === options.bookId)
        ? options.unknown
        : (resource.unknownProperties ?? [])
      const now = new Date()
      const next = book.syncToken + 1
      const removed = Boolean(options?.bookIds && !options.bookIds.includes(bookId))
      if (removed && resource.deletedAt) continue
      if (options?.deleted || removed) {
        await db
          .update(contactResources)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(contactResources.id, resource.id))
        await db.update(addressBooks).set({ syncToken: next, updatedAt: now }).where(eq(addressBooks.id, book.id))
        book.syncToken = next
        await db.insert(addressBookChanges).values({ addressBookId: book.id, syncToken: next, uid: resource.uid, deleted: true })
        primary = { etag: resource.etag, uid: resource.uid }
        continue
      }
      const parsed = toParsed(contact, methods, addressRows, uid, unknown)
      const vcardText = serializeVcard(parsed)
      const etag = makeEtag(vcardText)
      await db
        .update(contactResources)
        .set({ uid, etag, vcardText, unknownProperties: unknown, updatedAt: now, deletedAt: null })
        .where(eq(contactResources.id, resource.id))
      await db.update(addressBooks).set({ syncToken: next, updatedAt: now }).where(eq(addressBooks.id, book.id))
      book.syncToken = next
      await db.insert(addressBookChanges).values({ addressBookId: book.id, syncToken: next, uid, deleted: false })
      primary = { etag, uid }
    }
  }
  if (!primary) throw new AppError(500, 'Could not update the contact card')
  return primary
}

function toParsed(
  contact: typeof contacts.$inferSelect,
  methods: Array<typeof contactMethods.$inferSelect>,
  addressRows: Array<typeof addresses.$inferSelect>,
  uid: string,
  unknown: string[],
): ParsedCard {
  return {
    uid,
    fn: contact.displayName,
    n: {
      last: contact.lastName ?? '',
      first: contact.firstName ?? '',
      middle: contact.middleName ?? '',
      prefix: contact.prefix ?? '',
      suffix: contact.suffix ?? '',
    },
    nickname: contact.nickname ?? undefined,
    organization: contact.organizationName ?? undefined,
    department: contact.department ?? undefined,
    title: contact.title ?? undefined,
    position: contact.position ?? undefined,
    note: contact.cardNote ?? undefined,
    url: contact.website ?? undefined,
    birthday: contact.birthday ?? undefined,
    anniversary: contact.anniversary ?? undefined,
    emails: methods.filter((method) => method.kind === 'email').map((method) => ({ label: method.label, value: method.value })),
    phones: methods.filter((method) => method.kind === 'phone').map((method) => ({ label: method.label, value: method.value })),
    socials: methods.filter((method) => method.kind === 'social').map((method) => ({ label: method.label, value: method.value })),
    addresses: addressRows.map((row) => ({
      label: row.label,
      street: row.street,
      street2: row.street2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      country: row.country,
    })),
    unknown,
  }
}

export async function writeAudit(db: Db, workspaceId: string, actorId: string, action: string, entityId: string, entityType = 'contact', diff?: Record<string, unknown>) {
  await db.insert(auditLogs).values({ workspaceId, actorId, action, entityType, entityId, diff: diff ?? null })
}

async function recordAudit(db: Db, workspaceId: string, actorId: string, action: string, entityId: string) {
  await writeAudit(db, workspaceId, actorId, action, entityId)
}

export async function contactAccess(db: Database, userId: string, workspaceId: string, contactId: string) {
  const bundle = await loadBundle(db, contactId)
  const access = await assertCanReadContact(db, userId, workspaceId, bundle)
  const grants = await db
    .select({ userId: users.id, email: users.email, displayName: users.displayName, role: contactGrants.role })
    .from(contactGrants)
    .innerJoin(users, eq(users.id, contactGrants.userId))
    .where(eq(contactGrants.contactId, contactId))
    .orderBy(asc(users.displayName))
  const owner = bundle.contact.ownerId
    ? await db.select({ userId: users.id, email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, bundle.contact.ownerId)).limit(1)
    : []
  const groupRows = await db
    .select({ groupId: userGroups.id, name: userGroups.name, role: contactGroupGrants.role, userId: users.id, displayName: users.displayName })
    .from(contactGroupGrants)
    .innerJoin(userGroups, eq(userGroups.id, contactGroupGrants.groupId))
    .leftJoin(userGroupMembers, eq(userGroupMembers.groupId, userGroups.id))
    .leftJoin(users, eq(users.id, userGroupMembers.userId))
    .where(eq(contactGroupGrants.contactId, contactId))
    .orderBy(asc(userGroups.name), asc(users.displayName))
  const groups = new Map<string, { groupId: string; name: string; role: string; members: { userId: string; displayName: string }[] }>()
  for (const row of groupRows) {
    const current = groups.get(row.groupId) ?? { groupId: row.groupId, name: row.name, role: row.role, members: [] }
    if (row.userId && row.displayName) current.members.push({ userId: row.userId, displayName: row.displayName })
    groups.set(row.groupId, current)
  }
  return {
    visibility: bundle.contact.visibility,
    canManage: access.manage,
    owner: owner[0] ?? null,
    grants,
    groups: [...groups.values()],
  }
}

export async function setContactVisibility(db: Database, userId: string, workspaceId: string, contactId: string, visibility: 'workspace' | 'restricted') {
  await requireContactManage(db, userId, workspaceId, contactId)
  await db.update(contacts).set({ visibility, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  await writeAudit(db, workspaceId, userId, 'contact.access', contactId)
  return contactAccess(db, userId, workspaceId, contactId)
}

export async function setContactOwner(db: Database, userId: string, workspaceId: string, contactId: string, nextOwnerId: string) {
  const bundle = await requireContactManage(db, userId, workspaceId, contactId)
  if (bundle.contact.ownerId === nextOwnerId) return contactAccess(db, userId, workspaceId, contactId)
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, nextOwnerId)))
    .limit(1)
  if (!member) throw new AppError(400, 'Choose a member of this workspace')
  await db.delete(contactGrants).where(and(eq(contactGrants.contactId, contactId), eq(contactGrants.userId, nextOwnerId)))
  await db.update(contacts).set({ ownerId: nextOwnerId, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  await writeAudit(db, workspaceId, userId, 'contact.owner', contactId)
  return contactAccess(db, userId, workspaceId, contactId)
}

export async function grantContact(db: Database, userId: string, workspaceId: string, contactId: string, granteeId: string, role: ContactGrantRole) {
  const bundle = await requireContactManage(db, userId, workspaceId, contactId)
  if (granteeId === bundle.contact.ownerId) throw new AppError(400, 'The owner already has access')
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, granteeId)))
    .limit(1)
  if (!member) throw new AppError(400, 'Choose a member of this workspace')
  await db
    .insert(contactGrants)
    .values({ contactId, userId: granteeId, role })
    .onConflictDoUpdate({ target: [contactGrants.contactId, contactGrants.userId], set: { role } })
  await reflectSharing(db, contactId)
  await writeAudit(db, workspaceId, userId, 'contact.grant', contactId)
  return contactAccess(db, userId, workspaceId, contactId)
}

export async function grantContactGroup(db: Database, userId: string, workspaceId: string, contactId: string, groupId: string, role: ContactGrantRole) {
  await requireContactManage(db, userId, workspaceId, contactId)
  const [group] = await db.select().from(userGroups).where(and(eq(userGroups.id, groupId), eq(userGroups.workspaceId, workspaceId))).limit(1)
  if (!group) throw new AppError(400, 'Choose a group in this workspace')
  const applied = group.minRole === 'editor' ? 'editor' : role
  await db
    .insert(contactGroupGrants)
    .values({ contactId, groupId, role: applied })
    .onConflictDoUpdate({ target: [contactGroupGrants.contactId, contactGroupGrants.groupId], set: { role: applied } })
  await reflectSharing(db, contactId)
  await writeAudit(db, workspaceId, userId, 'contact.grant', contactId)
  return contactAccess(db, userId, workspaceId, contactId)
}

export async function revokeContactGrant(db: Database, userId: string, workspaceId: string, contactId: string, granteeId: string) {
  await requireContactManage(db, userId, workspaceId, contactId)
  await db.delete(contactGrants).where(and(eq(contactGrants.contactId, contactId), eq(contactGrants.userId, granteeId)))
  await reflectSharing(db, contactId)
  await writeAudit(db, workspaceId, userId, 'contact.revoke', contactId)
  return contactAccess(db, userId, workspaceId, contactId)
}

export async function revokeContactGroupGrant(db: Database, userId: string, workspaceId: string, contactId: string, groupId: string) {
  await requireContactManage(db, userId, workspaceId, contactId)
  await db.delete(contactGroupGrants).where(and(eq(contactGroupGrants.contactId, contactId), eq(contactGroupGrants.groupId, groupId)))
  await reflectSharing(db, contactId)
  await writeAudit(db, workspaceId, userId, 'contact.revoke', contactId)
  return contactAccess(db, userId, workspaceId, contactId)
}

export async function listContactDates(db: Database, userId: string, workspaceId: string, contactId: string) {
  await getContact(db, userId, workspaceId, contactId)
  const rows = await db.select().from(contactDates).where(eq(contactDates.contactId, contactId)).orderBy(asc(contactDates.occursOn))
  return rows.map((row) => ({ id: row.id, label: row.label, occursOn: row.occursOn }))
}

export async function addContactDate(db: Database, userId: string, workspaceId: string, contactId: string, input: z.infer<typeof contactDateSchema>) {
  await requireContactWrite(db, userId, workspaceId, contactId)
  const [row] = await db.insert(contactDates).values({ contactId, label: input.label.trim(), occursOn: input.occursOn }).returning()
  if (!row) throw new AppError(500, 'Could not save the date')
  return { id: row.id, label: row.label, occursOn: row.occursOn }
}

export async function updateContactDate(db: Database, userId: string, workspaceId: string, contactId: string, dateId: string, input: z.infer<typeof contactDateSchema>) {
  await requireContactWrite(db, userId, workspaceId, contactId)
  const [row] = await db
    .update(contactDates)
    .set({ label: input.label.trim(), occursOn: input.occursOn })
    .where(and(eq(contactDates.id, dateId), eq(contactDates.contactId, contactId)))
    .returning()
  if (!row) throw new AppError(404, 'Date not found')
  return { id: row.id, label: row.label, occursOn: row.occursOn }
}

export async function deleteContactDate(db: Database, userId: string, workspaceId: string, contactId: string, dateId: string) {
  await requireContactWrite(db, userId, workspaceId, contactId)
  const [row] = await db.delete(contactDates).where(and(eq(contactDates.id, dateId), eq(contactDates.contactId, contactId))).returning()
  if (!row) throw new AppError(404, 'Date not found')
}

function auditDetail(diff: unknown) {
  if (!diff || typeof diff !== 'object') return null
  const row = diff as { field?: unknown; sourceUrl?: unknown; outcome?: unknown }
  const parts = [row.outcome, row.field, row.sourceUrl].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length ? parts.join(' · ') : null
}

export async function listAudit(db: Database, userId: string, workspaceId: string, contactId?: string) {
  if (contactId) await getContact(db, userId, workspaceId, contactId)
  else await requireManager(db, userId, workspaceId)
  const filters = [eq(auditLogs.workspaceId, workspaceId)]
  if (contactId) filters.push(eq(auditLogs.entityId, contactId))
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      createdAt: auditLogs.createdAt,
      actorName: users.displayName,
      diff: auditLogs.diff,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .limit(contactId ? 30 : 100)
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    actorName: row.actorName ?? 'Someone',
    detail: auditDetail(row.diff),
  }))
}

export async function readableContactIds(db: Database, userId: string, bookRole: WorkspaceRole, contactIds: string[]) {
  const ids = [...new Set(contactIds)]
  if (!ids.length) return new Set<string>()
  const rows = await db
    .select({ id: contacts.id, visibility: contacts.visibility, ownerId: contacts.ownerId, workspaceId: contacts.workspaceId })
    .from(contacts)
    .where(inArray(contacts.id, ids))
  const workspaceIds = [...new Set(rows.map((row) => row.workspaceId))]
  const members = workspaceIds.length
    ? await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.workspaceId, workspaceIds)))
    : []
  const grants = await db
    .select()
    .from(contactGrants)
    .where(and(eq(contactGrants.userId, userId), inArray(contactGrants.contactId, ids)))
  const groupGrants = await db
    .select({ contactId: contactGroupGrants.contactId, role: contactGroupGrants.role })
    .from(contactGroupGrants)
    .innerJoin(userGroupMembers, eq(userGroupMembers.groupId, contactGroupGrants.groupId))
    .where(and(eq(userGroupMembers.userId, userId), inArray(contactGroupGrants.contactId, ids)))
  const memberByWorkspace = new Map(members.map((member) => [member.workspaceId, member.role]))
  const grantByContact = new Map<string, ContactGrantRole | null>()
  for (const row of rows) {
    const direct = grants.find((grant) => grant.contactId === row.id)?.role
    const viaGroup = groupGrants.filter((grant) => grant.contactId === row.id).map((grant) => grant.role)
    grantByContact.set(row.id, strongerGrant([direct, ...viaGroup]))
  }
  const allowed = new Set<string>()
  for (const row of rows) {
    const decision = decideContactAccess({
      visibility: row.visibility,
      ownerId: row.ownerId,
      userId,
      workspaceRole: memberByWorkspace.get(row.workspaceId) ?? null,
      grant: grantByContact.get(row.id) ?? null,
      bookRole,
    })
    if (decision.read) allowed.add(row.id)
  }
  return allowed
}

async function reflectSharing(db: Database, contactId: string) {
  const [person] = await db.select({ id: contactGrants.userId }).from(contactGrants).where(eq(contactGrants.contactId, contactId)).limit(1)
  const [group] = await db.select({ id: contactGroupGrants.groupId }).from(contactGroupGrants).where(eq(contactGroupGrants.contactId, contactId)).limit(1)
  await db.update(contacts).set({ visibility: person || group ? 'restricted' : 'workspace', updatedAt: new Date() }).where(eq(contacts.id, contactId))
}

function strongerGrant(roles: Array<string | null | undefined>): ContactGrantRole | null {
  if (roles.includes('editor')) return 'editor'
  if (roles.includes('viewer')) return 'viewer'
  return null
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } }
  return candidate.code === '23505' || candidate.cause?.code === '23505'
}
