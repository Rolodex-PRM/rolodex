import { randomUUID } from 'node:crypto'
import { addressBookChanges, addressBookMembers, addressBooks, contactResources, users, workspaceMembers, type Database, type WorkspaceRole } from '@rolodex/db'
import { readableContactIds } from './contacts'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { defaultWritableWorkspace, requireBook, requireWriter } from './access'
import { cardFingerprint, createContactFromCard, findDuplicates } from './contacts'
import { AppError } from './errors'
import { normalizeEmail, normalizePhone } from './normalize'
import { canManageMembers, roleAtLeast } from './permissions'
import { cardDisplayName, parseVcards, type ParsedCard } from './vcard'

export async function createAddressBook(
  db: Database,
  userId: string,
  workspaceId: string,
  name: string,
  urlSegment?: string,
  description?: string | null,
) {
  await requireWriter(db, userId, workspaceId)
  const id = randomUUID()
  try {
    const [book] = await db
      .insert(addressBooks)
      .values({
        id,
        workspaceId,
        name: name.trim() || 'Untitled',
        description: description ?? null,
        urlSegment: urlSegment?.trim() || id,
      })
      .returning()
    if (!book) throw new AppError(500, 'Could not create the address book')
    return book
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, 'An address book already uses that address')
    throw error
  }
}

export async function createAddressBookForPrincipal(db: Database, userId: string, name: string, urlSegment: string) {
  const workspaceId = await defaultWritableWorkspace(db, userId)
  return createAddressBook(db, userId, workspaceId, name, urlSegment)
}

export async function listAddressBooks(db: Database, userId: string, workspaceId?: string) {
  const ownFilters = [eq(workspaceMembers.userId, userId), isNull(addressBooks.deletedAt)]
  const sharedFilters = [eq(addressBookMembers.userId, userId), isNull(addressBooks.deletedAt)]
  if (workspaceId) ownFilters.push(eq(addressBooks.workspaceId, workspaceId))
  const own = await db
    .select({ book: addressBooks, role: workspaceMembers.role })
    .from(addressBooks)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, addressBooks.workspaceId))
    .where(and(...ownFilters))
    .orderBy(asc(addressBooks.name))
  const shared = await db
    .select({ book: addressBooks, role: addressBookMembers.role })
    .from(addressBooks)
    .innerJoin(addressBookMembers, eq(addressBookMembers.addressBookId, addressBooks.id))
    .where(and(...sharedFilters))
  const byId = new Map<string, (typeof own)[number]['book'] & { role: WorkspaceRole; shared: boolean }>()
  for (const row of own) byId.set(row.book.id, { ...row.book, role: row.role, shared: false })
  for (const row of shared) {
    const current = byId.get(row.book.id)
    if (!current) byId.set(row.book.id, { ...row.book, role: row.role, shared: true })
    else if (roleAtLeast(row.role, current.role)) byId.set(row.book.id, { ...current, role: row.role })
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function requireBookManager(db: Database, userId: string, bookId: string) {
  const access = await requireBook(db, userId, bookId)
  if (!canManageMembers(access.role)) throw new AppError(403, 'You do not have permission to share this address book')
  return access
}

export async function listBookShares(db: Database, userId: string, bookId: string) {
  const { book } = await requireBook(db, userId, bookId)
  const rows = await db
    .select({ userId: users.id, email: users.email, displayName: users.displayName, role: addressBookMembers.role })
    .from(addressBookMembers)
    .innerJoin(users, eq(users.id, addressBookMembers.userId))
    .where(eq(addressBookMembers.addressBookId, book.id))
    .orderBy(asc(users.displayName))
  return rows
}

export async function shareAddressBook(db: Database, userId: string, bookId: string, email: string, role: WorkspaceRole) {
  if (role === 'owner') throw new AppError(400, 'Share a book as a viewer, contributor, editor, or administrator')
  const { book } = await requireBookManager(db, userId, bookId)
  const [person] = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1)
  if (!person) throw new AppError(404, 'No account exists for that email')
  const [existing] = await db
    .select()
    .from(addressBookMembers)
    .where(and(eq(addressBookMembers.addressBookId, book.id), eq(addressBookMembers.userId, person.id)))
    .limit(1)
  if (existing) {
    await db.update(addressBookMembers).set({ role }).where(eq(addressBookMembers.id, existing.id))
  } else {
    await db.insert(addressBookMembers).values({ addressBookId: book.id, userId: person.id, role })
  }
  return { userId: person.id, email: person.email, displayName: person.displayName, role }
}

export async function unshareAddressBook(db: Database, userId: string, bookId: string, memberId: string) {
  const { book } = await requireBookManager(db, userId, bookId)
  await db
    .delete(addressBookMembers)
    .where(and(eq(addressBookMembers.addressBookId, book.id), eq(addressBookMembers.userId, memberId)))
}

export async function updateAddressBook(
  db: Database,
  userId: string,
  bookId: string,
  input: { name?: string; description?: string | null },
) {
  const { book } = await requireBook(db, userId, bookId, true)
  const [updated] = await db
    .update(addressBooks)
    .set({
      name: input.name?.trim() || book.name,
      description: input.description === undefined ? book.description : input.description,
      updatedAt: new Date(),
    })
    .where(eq(addressBooks.id, book.id))
    .returning()
  return updated
}

export async function deleteAddressBook(db: Database, userId: string, bookId: string) {
  const { book } = await requireBook(db, userId, bookId, true)
  const now = new Date()
  const live = await db
    .select()
    .from(contactResources)
    .where(and(eq(contactResources.addressBookId, book.id), isNull(contactResources.deletedAt)))
  let token = book.syncToken
  for (const resource of live) {
    token += 1
    await db.update(contactResources).set({ deletedAt: now, updatedAt: now }).where(eq(contactResources.id, resource.id))
    await db.insert(addressBookChanges).values({ addressBookId: book.id, syncToken: token, uid: resource.uid, deleted: true })
  }
  await db.update(addressBooks).set({ deletedAt: now, updatedAt: now, syncToken: token }).where(eq(addressBooks.id, book.id))
}

export async function exportAddressBook(db: Database, userId: string, bookId: string) {
  const { book, role } = await requireBook(db, userId, bookId)
  const rows = await db
    .select({ vcardText: contactResources.vcardText, contactId: contactResources.contactId })
    .from(contactResources)
    .where(and(eq(contactResources.addressBookId, book.id), isNull(contactResources.deletedAt)))
  const allowed = await readableContactIds(db, userId, role, rows.map((row) => row.contactId))
  const body = rows
    .filter((row) => allowed.has(row.contactId))
    .map((row) => row.vcardText.trim())
    .filter(Boolean)
    .join('\r\n')
  return {
    filename: `${book.name.replace(/[^\w.-]+/g, '_') || 'contacts'}.vcf`,
    body: body ? `${body}\r\n` : '',
  }
}

export async function importAddressBook(
  db: Database,
  userId: string,
  bookId: string,
  input: { vcf: string; commit?: boolean | undefined; decisions?: { fingerprint: string; action: 'create' | 'skip' }[] | undefined },
) {
  const { book } = await requireBook(db, userId, bookId, input.commit === true)
  const cards = parseVcards(input.vcf)
  const previews = []
  for (const card of cards) {
    const emails = card.emails.map((entry) => normalizeEmail(entry.value)).filter(Boolean)
    const phones = card.phones.map((entry) => normalizePhone(entry.value)).filter(Boolean)
    const duplicates = await findDuplicates(db, book.workspaceId, emails, phones)
    previews.push({
      fingerprint: cardFingerprint(card),
      displayName: cardDisplayName(card),
      emails: card.emails.map((entry) => entry.value),
      phones: card.phones.map((entry) => entry.value),
      duplicates,
    })
  }
  if (!input.commit) return { created: 0, skipped: 0, contacts: previews }
  let created = 0
  let skipped = 0
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]
    const preview = previews[index]
    if (!card || !preview) continue
    if (preview.duplicates.length) {
      const decision = input.decisions?.find((item) => item.fingerprint === preview.fingerprint)
      if (!decision || decision.action === 'skip') {
        skipped += 1
        continue
      }
    }
    await createContactFromCard(db, userId, book.id, card)
    created += 1
  }
  return { created, skipped, contacts: previews }
}

export function formatSyncToken(bookId: string, token: number) {
  return `http://rolodex/sync/${bookId}/${token}`
}

export function readSyncToken(value: string | null | undefined) {
  if (value == null || value.trim() === '') return null
  const match = value.trim().match(/(\d+)$/)
  if (!match?.[1]) throw new AppError(409, 'Sync token is no longer valid')
  return Number(match[1])
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } }
  return candidate.code === '23505' || candidate.cause?.code === '23505'
}

export type { ParsedCard }
