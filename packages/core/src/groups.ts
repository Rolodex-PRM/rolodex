import { userGroupMembers, userGroups, users, workspaceMembers, type Database } from '@rolodex/db'
import { and, asc, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { requireManager, requireMembership } from './access'
import { AppError } from './errors'
import { userGroupMemberSchema, userGroupSchema, userGroupUpdateSchema } from './validation'

export async function listUserGroups(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const groups = await db.select().from(userGroups).where(eq(userGroups.workspaceId, workspaceId)).orderBy(asc(userGroups.name))
  if (!groups.length) return []
  const members = await db
    .select({ groupId: userGroupMembers.groupId, userId: users.id, displayName: users.displayName, email: users.email })
    .from(userGroupMembers)
    .innerJoin(users, eq(users.id, userGroupMembers.userId))
    .orderBy(asc(users.displayName))
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    minRole: group.minRole === 'editor' ? 'editor' as const : 'viewer' as const,
    members: members.filter((member) => member.groupId === group.id).map(({ userId: id, displayName, email }) => ({ userId: id, displayName, email })),
  }))
}

export async function createUserGroup(db: Database, userId: string, workspaceId: string, input: z.infer<typeof userGroupSchema>) {
  await requireManager(db, userId, workspaceId)
  const name = input.name.trim()
  const [existing] = await db
    .select({ id: userGroups.id })
    .from(userGroups)
    .where(and(eq(userGroups.workspaceId, workspaceId), eq(userGroups.name, name)))
    .limit(1)
  if (existing) throw new AppError(409, 'A group already uses that name')
  const minRole = input.minRole === 'editor' ? 'editor' : 'viewer'
  const [row] = await db.insert(userGroups).values({ workspaceId, name, minRole }).returning()
  if (!row) throw new AppError(500, 'Could not create the group')
  return { id: row.id, name: row.name, minRole, members: [] }
}

export async function updateUserGroup(db: Database, userId: string, workspaceId: string, groupId: string, input: z.infer<typeof userGroupUpdateSchema>) {
  await requireManager(db, userId, workspaceId)
  const current = await assertGroup(db, workspaceId, groupId)
  const name = input.name?.trim() || current.name
  const minRole = input.minRole === 'editor' || input.minRole === 'viewer' ? input.minRole : current.minRole === 'editor' ? 'editor' : 'viewer'
  if (name !== current.name) {
    const [existing] = await db
      .select({ id: userGroups.id })
      .from(userGroups)
      .where(and(eq(userGroups.workspaceId, workspaceId), eq(userGroups.name, name)))
      .limit(1)
    if (existing && existing.id !== groupId) throw new AppError(409, 'A group already uses that name')
  }
  await db.update(userGroups).set({ name, minRole }).where(eq(userGroups.id, groupId))
  return listUserGroups(db, userId, workspaceId)
}

export async function deleteUserGroup(db: Database, userId: string, workspaceId: string, groupId: string) {
  await requireManager(db, userId, workspaceId)
  const [row] = await db.delete(userGroups).where(and(eq(userGroups.id, groupId), eq(userGroups.workspaceId, workspaceId))).returning()
  if (!row) throw new AppError(404, 'Group not found')
}

export async function addUserGroupMember(db: Database, userId: string, workspaceId: string, groupId: string, input: z.infer<typeof userGroupMemberSchema>) {
  await requireManager(db, userId, workspaceId)
  await assertGroup(db, workspaceId, groupId)
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, input.userId)))
    .limit(1)
  if (!member) throw new AppError(400, 'Choose a member of this workspace')
  await db.insert(userGroupMembers).values({ groupId, userId: input.userId }).onConflictDoNothing()
  return listUserGroups(db, userId, workspaceId)
}

export async function removeUserGroupMember(db: Database, userId: string, workspaceId: string, groupId: string, memberId: string) {
  await requireManager(db, userId, workspaceId)
  await assertGroup(db, workspaceId, groupId)
  await db.delete(userGroupMembers).where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, memberId)))
}

async function assertGroup(db: Database, workspaceId: string, groupId: string) {
  const [group] = await db.select().from(userGroups).where(and(eq(userGroups.id, groupId), eq(userGroups.workspaceId, workspaceId))).limit(1)
  if (!group) throw new AppError(404, 'Group not found')
  return group
}
