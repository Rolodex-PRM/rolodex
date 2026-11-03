import { contacts, users, workspaceMembers, workspaces, type Database, type WorkspaceRole } from '@rolodex/db'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { requireManager, requireMembership } from './access'
import { AppError } from './errors'
import { normalizeEmail } from './normalize'
import { roleAtLeast } from './permissions'

export async function createWorkspace(db: Database, userId: string, name: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: name.trim(), createdBy: userId })
    .returning()
  if (!workspace) throw new AppError(500, 'Could not create the workspace')
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: 'owner' })
  return workspace
}

export async function listWorkspaces(db: Database, userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.name))
}

export async function listMembers(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.displayName))
  const counts = await db
    .select({ ownerId: contacts.ownerId, total: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
    .groupBy(contacts.ownerId)
  const byOwner = new Map(counts.map((row) => [row.ownerId, Number(row.total)]))
  return rows.map((row) => ({ ...row, contactCount: byOwner.get(row.userId) ?? 0 }))
}

export async function addMember(db: Database, actorId: string, workspaceId: string, email: string, role: WorkspaceRole) {
  await requireManager(db, actorId, workspaceId)
  const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1)
  if (!user) throw new AppError(404, 'No account exists for that email')
  const [existing] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
    .limit(1)
  if (existing) throw new AppError(409, 'That person is already a member')
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role })
  return { userId: user.id, email: user.email, displayName: user.displayName, role }
}

export async function updateMemberRole(
  db: Database,
  actorId: string,
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
) {
  const actor = await requireManager(db, actorId, workspaceId)
  if (actor.userId === memberId && !roleAtLeast(role, actor.role)) {
    await assertOwnerRemains(db, workspaceId, memberId, role)
  } else {
    await assertOwnerRemains(db, workspaceId, memberId, role)
  }
  const [row] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)))
    .returning({ userId: workspaceMembers.userId, role: workspaceMembers.role })
  if (!row) throw new AppError(404, 'Member not found')
  return row
}

export async function removeMember(db: Database, actorId: string, workspaceId: string, memberId: string) {
  await requireManager(db, actorId, workspaceId)
  await assertOwnerRemains(db, workspaceId, memberId, null)
  const [row] = await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)))
    .returning({ userId: workspaceMembers.userId })
  if (!row) throw new AppError(404, 'Member not found')
}

async function assertOwnerRemains(db: Database, workspaceId: string, memberId: string, nextRole: WorkspaceRole | null) {
  const owners = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')))
  const remaining = owners.filter((owner) => owner.userId !== memberId).length + (nextRole === 'owner' ? 1 : 0)
  if (remaining < 1) throw new AppError(400, 'The workspace needs at least one owner')
}
