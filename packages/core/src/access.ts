import {
  addressBookMembers,
  addressBooks,
  users,
  workspaceMembers,
  type Database,
  type WorkspaceRole,
} from '@rolodex/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { AppError } from './errors'
import { isUuid } from './normalize'
import { canManageMembers, canWriteContacts, roleAtLeast } from './permissions'

export type Db = Database

export async function requireMembership(db: Db, userId: string, workspaceId: string, minimum?: WorkspaceRole) {
  if (!isUuid(workspaceId)) throw new AppError(400, 'Invalid workspace')
  const [row] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)
  if (!row) throw new AppError(404, 'Workspace not found')
  if (minimum && !roleAtLeast(row.role, minimum)) {
    throw new AppError(403, 'You do not have permission to do that')
  }
  return row
}

export async function requireWriter(db: Db, userId: string, workspaceId: string) {
  const member = await requireMembership(db, userId, workspaceId)
  if (!canWriteContacts(member.role)) throw new AppError(403, 'You do not have permission to edit contacts')
  return member
}

export async function requireManager(db: Db, userId: string, workspaceId: string) {
  const member = await requireMembership(db, userId, workspaceId)
  if (!canManageMembers(member.role)) throw new AppError(403, 'You do not have permission to manage members')
  return member
}

export async function findAddressBook(db: Db, ref: string) {
  const predicate = isUuid(ref)
    ? and(isNull(addressBooks.deletedAt), eq(addressBooks.id, ref))
    : and(isNull(addressBooks.deletedAt), eq(addressBooks.urlSegment, ref))
  const [byId] = await db.select().from(addressBooks).where(predicate!).limit(1)
  if (byId) return byId
  if (!isUuid(ref)) return undefined
  const [bySegment] = await db
    .select()
    .from(addressBooks)
    .where(and(isNull(addressBooks.deletedAt), eq(addressBooks.urlSegment, ref)))
    .limit(1)
  return bySegment
}

export async function requireBook(db: Db, userId: string, ref: string, write = false) {
  const book = await findAddressBook(db, ref)
  if (!book) throw new AppError(404, 'Address book not found')
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, book.workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)
  const [share] = await db
    .select()
    .from(addressBookMembers)
    .where(and(eq(addressBookMembers.addressBookId, book.id), eq(addressBookMembers.userId, userId)))
    .limit(1)
  const role = member && share ? (roleAtLeast(share.role, member.role) ? share.role : member.role) : member?.role ?? share?.role
  if (!role) throw new AppError(404, 'Address book not found')
  if (write && !canWriteContacts(role)) {
    throw new AppError(403, 'You do not have permission to edit this address book')
  }
  return { book, role }
}

export async function defaultWritableWorkspace(db: Db, userId: string) {
  const rows = await db
    .select({ role: workspaceMembers.role, workspaceId: workspaceMembers.workspaceId, createdAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
  const writable = rows.filter((row) => canWriteContacts(row.role))
  if (!writable.length) throw new AppError(403, 'You cannot create an address book')
  const preferred = writable.find((row) => row.role === 'owner') ?? writable.find((row) => row.role === 'administrator') ?? writable[0]
  return preferred!.workspaceId
}

export async function userById(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  return user
}
