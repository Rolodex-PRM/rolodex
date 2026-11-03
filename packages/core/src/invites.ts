import { passwordResets, sessions, users, workspaceInvites, workspaceMembers, workspaces, type Database, type WorkspaceRole } from '@rolodex/db'
import { and, eq, gt } from 'drizzle-orm'
import type { z } from 'zod'
import { requireManager } from './access'
import { registerUser } from './auth'
import { AppError } from './errors'
import { normalizeEmail } from './normalize'
import { hashPassword } from './passwords'
import { publicAppUrl, sendAccountEmail } from './notify'
import { readSettings, writeSettings } from './server-store'
import { hashToken, newToken } from './secrets'
import type { passwordResetSchema, registerSchema } from './validation'

const policyKey = 'auth.registration'
const inviteMs = 7 * 24 * 60 * 60 * 1000
const resetMs = 2 * 60 * 60 * 1000

export async function registrationPolicy(db: Database) {
  const stored = await readSettings(db, policyKey, { inviteOnly: false })
  return { inviteOnly: stored.inviteOnly === true }
}

export async function setRegistrationPolicy(db: Database, userId: string, workspaceId: string, inviteOnly: boolean) {
  await requireManager(db, userId, workspaceId)
  await writeSettings(db, policyKey, { inviteOnly })
  return { inviteOnly }
}

export async function inviteUser(db: Database, actorId: string, workspaceId: string, emailInput: string, role: WorkspaceRole) {
  await requireManager(db, actorId, workspaceId)
  const email = normalizeEmail(emailInput)
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
  if (existing) throw new AppError(409, 'That person already has an account. Add them as a user instead.')
  const [workspace] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
  if (!workspace) throw new AppError(404, 'Workspace not found')
  const token = newToken()
  const [row] = await db
    .insert(workspaceInvites)
    .values({ workspaceId, email, role, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + inviteMs), createdBy: actorId })
    .returning({ id: workspaceInvites.id })
  if (!row) throw new AppError(500, 'Could not create the invitation')
  const link = `${await publicAppUrl(db)}/sign-up?invite=${encodeURIComponent(token)}`
  try {
    await sendAccountEmail(
      db,
      email,
      `Join ${workspace.name} on Rolodex`,
      `You've been invited to join ${workspace.name} on Rolodex.\n\nCreate your account:\n${link}\n\nThis link expires in 7 days.`,
    )
  } catch (error) {
    await db.delete(workspaceInvites).where(eq(workspaceInvites.id, row.id))
    throw error
  }
  return { ok: true }
}

export async function previewInvite(db: Database, token: string) {
  const invite = await loadInvite(db, token)
  const [workspace] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, invite.workspaceId)).limit(1)
  return { email: invite.email, workspaceName: workspace?.name ?? 'a workspace' }
}

export async function acceptInvite(db: Database, input: z.infer<typeof registerSchema>) {
  if (!input.invite) throw new AppError(400, 'This invitation is missing')
  const invite = await loadInvite(db, input.invite)
  if (normalizeEmail(input.email) !== invite.email) throw new AppError(400, 'Use the email address the invitation was sent to')
  const result = await registerUser(db, input)
  await joinWorkspace(db, invite.workspaceId, result.user.id, invite.role)
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id))
  return result
}

export async function pendingInvite(db: Database, emailInput: string) {
  const email = normalizeEmail(emailInput)
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.email, email), gt(workspaceInvites.expiresAt, new Date())))
    .limit(1)
  return invite ?? null
}

export async function consumeInvite(db: Database, inviteId: string, userId: string) {
  const [invite] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.id, inviteId)).limit(1)
  if (!invite || invite.expiresAt.getTime() < Date.now()) return
  await joinWorkspace(db, invite.workspaceId, userId, invite.role)
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id))
}

async function joinWorkspace(db: Database, workspaceId: string, userId: string, role: WorkspaceRole) {
  const [already] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1)
  if (!already) await db.insert(workspaceMembers).values({ workspaceId, userId, role })
}

export async function sendPasswordReset(db: Database, actorId: string, workspaceId: string, memberId: string) {
  await requireManager(db, actorId, workspaceId)
  const [member] = await db
    .select({ email: users.email, userId: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)))
    .limit(1)
  if (!member) throw new AppError(404, 'Member not found')
  const token = newToken()
  await db.delete(passwordResets).where(eq(passwordResets.userId, member.userId))
  const [row] = await db
    .insert(passwordResets)
    .values({ userId: member.userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + resetMs) })
    .returning({ id: passwordResets.id })
  const link = `${await publicAppUrl(db)}/reset-password?token=${encodeURIComponent(token)}`
  try {
    await sendAccountEmail(
      db,
      member.email,
      'Reset your Rolodex password',
      `A workspace administrator asked to reset your Rolodex password.\n\nChoose a new password:\n${link}\n\nThis link expires in 2 hours. If you did not expect this, you can ignore it.`,
    )
  } catch (error) {
    if (row) await db.delete(passwordResets).where(eq(passwordResets.id, row.id))
    throw error
  }
  return { ok: true }
}

export async function resetPassword(db: Database, input: z.infer<typeof passwordResetSchema>) {
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, hashToken(input.token)), gt(passwordResets.expiresAt, new Date())))
    .limit(1)
  if (!row) throw new AppError(400, 'This reset link is no longer valid')
  await db.update(users).set({ passwordHash: await hashPassword(input.password), updatedAt: new Date() }).where(eq(users.id, row.userId))
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, row.userId))
  await db.delete(passwordResets).where(eq(passwordResets.userId, row.userId))
  return { ok: true }
}

async function loadInvite(db: Database, token: string) {
  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.tokenHash, hashToken(token.trim())), gt(workspaceInvites.expiresAt, new Date())))
    .limit(1)
  if (!invite) throw new AppError(400, 'This invitation is no longer valid')
  return invite
}
