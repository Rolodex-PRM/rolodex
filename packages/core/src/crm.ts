import {
  activities,
  activityContacts,
  attachments,
  contacts,
  customFieldDefinitions,
  customFieldValues,
  interactionFiles,
  notes,
  organizationMemberships,
  organizations,
  relationshipDismissals,
  relationshipTypes,
  relationships,
  reminders,
  tasks,
  type Database,
} from '@rolodex/db'
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { requireManager, requireMembership, requireWriter, type Db } from './access'
import { getContact, requireContactWrite, visibleContactSql, writeAudit } from './contacts'
import { AppError } from './errors'
import { inferRelationships } from './relationships'
import { organizationLogoUrl } from './organization-logo'
import {
  activitySchema,
  customFieldSchema,
  customValueSchema,
  noteSchema,
  organizationMemberSchema,
  organizationSchema,
  relationshipSchema,
  relationshipTypeSchema,
  reminderSchema,
  taskSchema,
} from './validation'

const reverseType: Record<string, string> = {
  spouse: 'spouse',
  parent: 'child',
  child: 'parent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  sibling: 'sibling',
  'aunt/uncle': 'niece/nephew',
  'niece/nephew': 'aunt/uncle',
  cousin: 'cousin',
  coworker: 'coworker',
  'boyfriend/girlfriend': 'boyfriend/girlfriend',
  relative: 'relative',
  friend: 'friend',
  neighbor: 'neighbor',
  acquaintance: 'acquaintance',
  colleague: 'colleague',
  manager: 'employee',
  employee: 'manager',
  'business partner': 'business partner',
  client: 'vendor',
  vendor: 'client',
  customer: 'supplier',
  supplier: 'customer',
  'introduced by': 'introduction',
  introduction: 'introduced by',
  'mutual friend': 'mutual friend',
  community: 'community',
}

function reciprocal(type: string) {
  return reverseType[type.toLowerCase()] ?? type
}

const defaultRelationshipTypes = [
  ['spouse', 'spouse'],
  ['parent', 'child'],
  ['grandparent', 'grandchild'],
  ['sibling', 'sibling'],
  ['aunt/uncle', 'niece/nephew'],
  ['cousin', 'cousin'],
  ['boyfriend/girlfriend', 'boyfriend/girlfriend'],
  ['coworker', 'coworker'],
  ['friend', 'friend'],
] as const

const cadenceDays: Record<string, { days: number; label: string }> = {
  '7': { days: 7, label: 'every week' },
  '14': { days: 14, label: 'every 2 weeks' },
  '30': { days: 30, label: 'every month' },
  '90': { days: 90, label: 'every quarter' },
  '180': { days: 180, label: 'every 6 months' },
  '365': { days: 365, label: 'every year' },
}

async function writer(db: Db, userId: string, workspaceId: string) {
  await requireWriter(db, userId, workspaceId)
}

async function reader(db: Db, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
}

function visible(userId: string, visibility: string, ownerId: string | null) {
  return visibility === 'workspace' || ownerId === userId
}

export async function listRelationships(db: Database, userId: string, workspaceId: string, contactId: string) {
  await getContact(db, userId, workspaceId, contactId)
  try {
    await requireWriter(db, userId, workspaceId)
    await syncInferredRelationships(db, workspaceId)
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 403) throw error
  }
  const rows = await db
    .select({
      id: relationships.id,
      category: relationships.category,
      type: relationships.type,
      description: relationships.description,
      origin: relationships.origin,
      contactId: contacts.id,
      displayName: contacts.displayName,
    })
    .from(relationships)
    .innerJoin(contacts, eq(contacts.id, relationships.toContactId))
    .where(and(eq(relationships.fromContactId, contactId), eq(relationships.workspaceId, workspaceId), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.displayName))
  return rows.map((row) => ({ ...row, inferred: row.origin === 'inferred' }))
}

export async function listRelationshipTypes(db: Database, userId: string, workspaceId: string) {
  await reader(db, userId, workspaceId)
  await ensureRelationshipTypes(db, workspaceId)
  const rows = await db.select().from(relationshipTypes).where(eq(relationshipTypes.workspaceId, workspaceId)).orderBy(asc(relationshipTypes.label))
  return rows.map(presentRelationshipType)
}

async function ensureRelationshipTypes(db: Database, workspaceId: string) {
  const rows = await db.select().from(relationshipTypes).where(eq(relationshipTypes.workspaceId, workspaceId))
  const used = new Set(rows.flatMap((row) => [row.label.toLowerCase(), row.reciprocalLabel.toLowerCase()]))
  const missing = defaultRelationshipTypes.filter(([label, reciprocalLabel]) => !used.has(label) && !used.has(reciprocalLabel))
  if (!missing.length) return
  await db
    .insert(relationshipTypes)
    .values(missing.map(([label, reciprocalLabel]) => ({ workspaceId, label, reciprocalLabel })))
    .onConflictDoNothing()
}

export async function createRelationshipType(db: Database, userId: string, workspaceId: string, input: z.infer<typeof relationshipTypeSchema>) {
  await requireManager(db, userId, workspaceId)
  const label = input.label.trim()
  const reciprocalLabel = input.reciprocalLabel.trim()
  const rows = await db.select().from(relationshipTypes).where(eq(relationshipTypes.workspaceId, workspaceId))
  const used = new Set(rows.flatMap((row) => [row.label.toLowerCase(), row.reciprocalLabel.toLowerCase()]))
  if (used.has(label.toLowerCase()) || used.has(reciprocalLabel.toLowerCase())) throw new AppError(409, 'That side is already used by another relationship')
  const [row] = await db.insert(relationshipTypes).values({ workspaceId, label, reciprocalLabel }).returning()
  return presentRelationshipType(row!)
}

export async function deleteRelationshipType(db: Database, userId: string, workspaceId: string, typeId: string) {
  await requireManager(db, userId, workspaceId)
  const [row] = await db.delete(relationshipTypes).where(and(eq(relationshipTypes.id, typeId), eq(relationshipTypes.workspaceId, workspaceId))).returning()
  if (!row) throw new AppError(404, 'Relationship not found')
}

export async function createRelationship(db: Database, userId: string, workspaceId: string, contactId: string, input: z.infer<typeof relationshipSchema>) {
  await writer(db, userId, workspaceId)
  if (input.toContactId === contactId) throw new AppError(400, 'Choose a different person')
  await getContact(db, userId, workspaceId, contactId)
  await getContact(db, userId, workspaceId, input.toContactId)
  const [definition] = await db
    .select()
    .from(relationshipTypes)
    .where(and(eq(relationshipTypes.id, input.typeId), eq(relationshipTypes.workspaceId, workspaceId)))
    .limit(1)
  if (!definition) throw new AppError(404, 'Choose a relationship defined in Admin')
  const type = input.side === 'label' ? definition.label : definition.reciprocalLabel
  const back = input.side === 'label' ? definition.reciprocalLabel : definition.label
  await db.delete(relationships).where(and(eq(relationships.workspaceId, workspaceId), eq(relationships.origin, 'inferred'), pairEither(contactId, input.toContactId)))
  await clearDismissals(db, workspaceId, contactId, input.toContactId)
  const existing = await db
    .select({ id: relationships.id })
    .from(relationships)
    .where(and(eq(relationships.fromContactId, contactId), eq(relationships.toContactId, input.toContactId), eq(relationships.type, type)))
    .limit(1)
  if (existing.length) throw new AppError(409, 'That relationship already exists')
  const [row] = await db
    .insert(relationships)
    .values({
      workspaceId,
      relationshipTypeId: definition.id,
      fromContactId: contactId,
      toContactId: input.toContactId,
      category: 'custom',
      type,
      reciprocalType: back,
      origin: 'explicit',
    })
    .returning()
  await db.insert(relationships).values({
    workspaceId,
    relationshipTypeId: definition.id,
    fromContactId: input.toContactId,
    toContactId: contactId,
    category: 'custom',
    type: back,
    reciprocalType: type,
    origin: 'explicit',
  }).onConflictDoNothing()
  await syncInferredRelationships(db, workspaceId)
  return row
}

export async function deleteRelationship(db: Database, userId: string, workspaceId: string, relationshipId: string) {
  await writer(db, userId, workspaceId)
  const [row] = await db.select().from(relationships).where(and(eq(relationships.id, relationshipId), eq(relationships.workspaceId, workspaceId))).limit(1)
  if (!row) throw new AppError(404, 'Relationship not found')
  const backType = row.reciprocalType ?? reciprocal(row.type)
  if (row.origin === 'inferred') {
    await db
      .insert(relationshipDismissals)
      .values([
        { workspaceId, fromContactId: row.fromContactId, toContactId: row.toContactId, type: row.type },
        { workspaceId, fromContactId: row.toContactId, toContactId: row.fromContactId, type: backType },
      ])
      .onConflictDoNothing()
  }
  await db
    .delete(relationships)
    .where(
      or(
        eq(relationships.id, row.id),
        and(eq(relationships.fromContactId, row.toContactId), eq(relationships.toContactId, row.fromContactId), eq(relationships.type, backType)),
      ),
    )
  await syncInferredRelationships(db, workspaceId)
}

function pairEither(left: string, right: string) {
  return or(
    and(eq(relationships.fromContactId, left), eq(relationships.toContactId, right)),
    and(eq(relationships.fromContactId, right), eq(relationships.toContactId, left)),
  )
}

async function clearDismissals(db: Database, workspaceId: string, left: string, right: string) {
  await db.delete(relationshipDismissals).where(and(
    eq(relationshipDismissals.workspaceId, workspaceId),
    or(
      and(eq(relationshipDismissals.fromContactId, left), eq(relationshipDismissals.toContactId, right)),
      and(eq(relationshipDismissals.fromContactId, right), eq(relationshipDismissals.toContactId, left)),
    ),
  ))
}

export async function syncInferredRelationships(db: Database, workspaceId: string) {
  await ensureRelationshipTypes(db, workspaceId)
  const types = await db.select().from(relationshipTypes).where(eq(relationshipTypes.workspaceId, workspaceId))
  const rows = await db.select().from(relationships).where(eq(relationships.workspaceId, workspaceId))
  const explicit = rows.filter((row) => row.origin !== 'inferred')
  const inferred = rows.filter((row) => row.origin === 'inferred')
  const dismissals = await db.select().from(relationshipDismissals).where(eq(relationshipDismissals.workspaceId, workspaceId))
  const dismissed = new Set(dismissals.map((row) => `${row.fromContactId}\0${row.toContactId}\0${row.type.toLowerCase()}`))
  const desired = inferRelationships(explicit.map((row) => ({ from: row.fromContactId, to: row.toContactId, type: row.type })))
  const desiredKey = (from: string, to: string, type: string) => `${from}\0${to}\0${type.toLowerCase()}`
  const wanted = new Set(desired.map((edge) => desiredKey(edge.from, edge.to, edge.type)))
  const stale = inferred.filter((row) => !wanted.has(desiredKey(row.fromContactId, row.toContactId, row.type)))
  if (stale.length) await db.delete(relationships).where(inArray(relationships.id, stale.map((row) => row.id)))
  const present = new Set(rows.map((row) => desiredKey(row.fromContactId, row.toContactId, row.type)))
  const missing = desired.filter((edge) => !present.has(desiredKey(edge.from, edge.to, edge.type)) && !dismissed.has(desiredKey(edge.from, edge.to, edge.type)))
  if (!missing.length) return
  const typeId = (type: string) => types.find((row) => row.label.toLowerCase() === type || row.reciprocalLabel.toLowerCase() === type)?.id ?? null
  await db.insert(relationships).values(missing.map((edge) => ({
    workspaceId,
    relationshipTypeId: typeId(edge.type),
    fromContactId: edge.from,
    toContactId: edge.to,
    category: 'inferred',
    type: edge.type,
    reciprocalType: reciprocal(edge.type),
    origin: 'inferred',
  }))).onConflictDoNothing()
}

export async function listOrganizations(db: Database, userId: string, workspaceId: string) {
  await reader(db, userId, workspaceId)
  const rows = await db.select().from(organizations).where(and(eq(organizations.workspaceId, workspaceId), isNull(organizations.deletedAt))).orderBy(asc(organizations.name))
  return rows.map(presentOrganization)
}

export async function createOrganization(db: Database, userId: string, workspaceId: string, input: z.infer<typeof organizationSchema>) {
  await writer(db, userId, workspaceId)
  const [row] = await db.insert(organizations).values({ workspaceId, ...orgValues(input) }).returning()
  return presentOrganization(row!)
}

export async function updateOrganization(db: Database, userId: string, workspaceId: string, organizationId: string, input: z.infer<typeof organizationSchema>) {
  await writer(db, userId, workspaceId)
  const [row] = await db
    .update(organizations)
    .set({ ...patchOrg(input), updatedAt: new Date() })
    .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId), isNull(organizations.deletedAt)))
    .returning()
  if (!row) throw new AppError(404, 'Organization not found')
  return presentOrganization(row)
}

export async function deleteOrganization(db: Database, userId: string, workspaceId: string, organizationId: string) {
  await writer(db, userId, workspaceId)
  const [row] = await db.update(organizations).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId))).returning()
  if (!row) throw new AppError(404, 'Organization not found')
}

export async function addOrganizationMember(db: Database, userId: string, workspaceId: string, organizationId: string, input: z.infer<typeof organizationMemberSchema>) {
  await writer(db, userId, workspaceId)
  await assertOrganization(db, workspaceId, organizationId)
  await getContact(db, userId, workspaceId, input.contactId)
  await db
    .insert(organizationMemberships)
    .values({ organizationId, contactId: input.contactId, department: input.department ?? null, title: input.title ?? null, isPrimary: input.isPrimary ?? false })
    .onConflictDoNothing()
  return { ok: true }
}

export async function removeOrganizationMember(db: Database, userId: string, workspaceId: string, organizationId: string, contactId: string) {
  await writer(db, userId, workspaceId)
  await assertOrganization(db, workspaceId, organizationId)
  await db.delete(organizationMemberships).where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.contactId, contactId)))
}

export async function organizationMembers(db: Database, userId: string, workspaceId: string, organizationId: string) {
  await reader(db, userId, workspaceId)
  await assertOrganization(db, workspaceId, organizationId)
  return db
    .select({ contactId: contacts.id, displayName: contacts.displayName, title: organizationMemberships.title, department: organizationMemberships.department })
    .from(organizationMemberships)
    .innerJoin(contacts, eq(contacts.id, organizationMemberships.contactId))
    .where(and(eq(organizationMemberships.organizationId, organizationId), isNull(contacts.deletedAt)))
    .orderBy(asc(contacts.displayName))
}

export async function contactOrganizations(db: Database, userId: string, workspaceId: string, contactId: string) {
  await getContact(db, userId, workspaceId, contactId)
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, title: organizationMemberships.title, department: organizationMemberships.department, website: organizations.website })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.contactId, contactId), eq(organizations.workspaceId, workspaceId), isNull(organizations.deletedAt)))
  return rows.map((row) => ({ ...row, logoUrl: organizationLogoUrl(row.website) }))
}

export async function listNotes(db: Database, userId: string, workspaceId: string, contactId: string) {
  await getContact(db, userId, workspaceId, contactId)
  const rows = await db.select().from(notes).where(and(eq(notes.contactId, contactId), eq(notes.workspaceId, workspaceId), isNull(notes.deletedAt))).orderBy(desc(notes.createdAt))
  const visibleNotes = rows.filter((row) => visible(userId, row.visibility, row.authorId)).map(presentNote)
  return attachFiles(db, visibleNotes, 'note')
}

export async function createNote(db: Database, userId: string, workspaceId: string, input: z.infer<typeof noteSchema>) {
  await requireContactWrite(db, userId, workspaceId, input.contactId)
  const [row] = await db
    .insert(notes)
    .values({ workspaceId, contactId: input.contactId, authorId: userId, body: input.body.trim(), visibility: input.visibility ?? 'private' })
    .returning()
  await writeAudit(db, workspaceId, userId, 'note.create', input.contactId, 'note')
  const [presented] = await attachFiles(db, [presentNote(row!)], 'note')
  return presented!
}

export async function deleteNote(db: Database, userId: string, workspaceId: string, noteId: string) {
  await writer(db, userId, workspaceId)
  const [row] = await db.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.workspaceId, workspaceId), isNull(notes.deletedAt))).limit(1)
  if (!row) throw new AppError(404, 'Note not found')
  if (row.visibility === 'private' && row.authorId !== userId) throw new AppError(404, 'Note not found')
  if (row.contactId) await requireContactWrite(db, userId, workspaceId, row.contactId)
  else await writer(db, userId, workspaceId)
  await db.update(notes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(notes.id, row.id))
  if (row.contactId) await writeAudit(db, workspaceId, userId, 'note.delete', row.contactId, 'note')
}

export async function listActivities(db: Database, userId: string, workspaceId: string, contactId?: string) {
  if (contactId) await getContact(db, userId, workspaceId, contactId)
  else await reader(db, userId, workspaceId)
  const rows = contactId
    ? await db
        .select({ activity: activities })
        .from(activities)
        .innerJoin(activityContacts, eq(activityContacts.activityId, activities.id))
        .where(and(eq(activityContacts.contactId, contactId), eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt)))
        .orderBy(desc(activities.occurredAt))
    : await db
        .select({ activity: activities })
        .from(activities)
        .where(and(eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt)))
        .orderBy(desc(activities.occurredAt))
        .limit(100)
  const visibleRows = rows.map((row) => row.activity).filter((row) => visible(userId, row.visibility, row.createdBy))
  return attachActivityPeople(db, visibleRows)
}

export async function createActivity(db: Database, userId: string, workspaceId: string, input: z.infer<typeof activitySchema>) {
  for (const contactId of input.contactIds) await requireContactWrite(db, userId, workspaceId, contactId)
  const occurredAt = new Date(input.occurredAt)
  if (Number.isNaN(occurredAt.getTime())) throw new AppError(400, 'Use a valid date')
  const [row] = await db
    .insert(activities)
    .values({
      workspaceId,
      type: input.type.trim(),
      occurredAt,
      description: input.description ?? null,
      location: input.location ?? null,
      visibility: input.visibility ?? 'workspace',
      createdBy: userId,
    })
    .returning()
  await db.insert(activityContacts).values(input.contactIds.map((contactId) => ({ activityId: row!.id, contactId })))
  const touched = await db
    .select({ id: contacts.id, lastInteractionAt: contacts.lastInteractionAt })
    .from(contacts)
    .where(inArray(contacts.id, input.contactIds))
  for (const person of touched) {
    if (!person.lastInteractionAt || person.lastInteractionAt < occurredAt) {
      await db.update(contacts).set({ lastInteractionAt: occurredAt }).where(eq(contacts.id, person.id))
    }
  }
  const [presented] = await attachActivityPeople(db, [row!])
  for (const contactId of input.contactIds) await writeAudit(db, workspaceId, userId, 'activity.create', contactId, 'activity')
  return presented
}

export async function deleteActivity(db: Database, userId: string, workspaceId: string, activityId: string) {
  const [row] = await db.select().from(activities).where(and(eq(activities.id, activityId), eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt))).limit(1)
  if (!row || !visible(userId, row.visibility, row.createdBy)) throw new AppError(404, 'Interaction not found')
  const people = await db.select({ contactId: activityContacts.contactId }).from(activityContacts).where(eq(activityContacts.activityId, row.id))
  if (people.length) {
    for (const person of people) await requireContactWrite(db, userId, workspaceId, person.contactId)
  } else {
    await writer(db, userId, workspaceId)
  }
  await db.update(activities).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(activities.id, row.id))
  for (const person of people) await writeAudit(db, workspaceId, userId, 'activity.delete', person.contactId, 'activity')
}

export async function listTasks(db: Database, userId: string, workspaceId: string, contactId?: string) {
  if (contactId) await getContact(db, userId, workspaceId, contactId)
  else await reader(db, userId, workspaceId)
  const filters = [eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt), taskVisibleSql(userId), taskContactSql(userId)]
  if (contactId) filters.push(eq(tasks.contactId, contactId))
  const rows = await db.select().from(tasks).where(and(...filters)).orderBy(asc(tasks.dueAt))
  return rows.map(presentTask)
}

export async function createTask(db: Database, userId: string, workspaceId: string, input: z.infer<typeof taskSchema>) {
  if (input.contactId) await requireContactWrite(db, userId, workspaceId, input.contactId)
  else await writer(db, userId, workspaceId)
  const [row] = await db
    .insert(tasks)
    .values({
      workspaceId,
      uid: randomUUID(),
      title: input.title.trim(),
      visibility: input.visibility ?? 'workspace',
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      priority: input.priority ?? 0,
      notes: input.notes?.trim() || null,
      rrule: input.rrule?.trim() || null,
      contactId: input.contactId ?? null,
      activityId: input.activityId ?? null,
      createdBy: userId,
      assigneeId: userId,
    })
    .returning()
  await writeAudit(db, workspaceId, userId, 'task.create', input.contactId ?? row!.id, 'task')
  return presentTask(row!)
}

export async function completeTask(db: Database, userId: string, workspaceId: string, taskId: string, done: boolean) {
  const existing = await readableTask(db, userId, workspaceId, taskId)
  if (existing.contactId) await requireContactWrite(db, userId, workspaceId, existing.contactId)
  else await writer(db, userId, workspaceId)
  const [row] = await db
    .update(tasks)
    .set({ completedAt: done ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .returning()
  if (!row) throw new AppError(404, 'Task not found')
  await writeAudit(db, workspaceId, userId, 'task.complete', row.contactId ?? row.id, 'task')
  return presentTask(row)
}

export async function deleteTask(db: Database, userId: string, workspaceId: string, taskId: string) {
  const existing = await readableTask(db, userId, workspaceId, taskId)
  if (existing.contactId) await requireContactWrite(db, userId, workspaceId, existing.contactId)
  else await writer(db, userId, workspaceId)
  const [row] = await db.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).returning()
  if (!row) throw new AppError(404, 'Task not found')
  await writeAudit(db, workspaceId, userId, 'task.delete', row.contactId ?? row.id, 'task')
}

export async function createReminder(db: Database, userId: string, workspaceId: string, input: z.infer<typeof reminderSchema>) {
  await writer(db, userId, workspaceId)
  if (!input.contactId && !input.taskId) throw new AppError(400, 'Choose a person or a task')
  if (input.contactId) await getContact(db, userId, workspaceId, input.contactId)
  const remindAt = new Date(input.remindAt)
  if (Number.isNaN(remindAt.getTime())) throw new AppError(400, 'Use a valid date')
  const [row] = await db
    .insert(reminders)
    .values({ workspaceId, type: input.type.trim(), remindAt, recurrence: input.recurrence ?? null, contactId: input.contactId ?? null, taskId: input.taskId ?? null, assigneeId: userId })
    .returning()
  return { id: row!.id, type: row!.type, remindAt: row!.remindAt.toISOString(), contactId: row!.contactId }
}

export async function listCustomFields(db: Database, userId: string, workspaceId: string, contactId: string) {
  await getContact(db, userId, workspaceId, contactId)
  const definitions = await db.select().from(customFieldDefinitions).where(and(eq(customFieldDefinitions.workspaceId, workspaceId), eq(customFieldDefinitions.entityType, 'contact'))).orderBy(asc(customFieldDefinitions.label))
  const values = definitions.length
    ? await db.select().from(customFieldValues).where(and(eq(customFieldValues.entityId, contactId), inArray(customFieldValues.definitionId, definitions.map((item) => item.id))))
    : []
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    fieldType: definition.fieldType,
    value: values.find((item) => item.definitionId === definition.id)?.value ?? null,
  }))
}

export async function createCustomField(db: Database, userId: string, workspaceId: string, input: z.infer<typeof customFieldSchema>) {
  await writer(db, userId, workspaceId)
  const key = input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'field'
  const [row] = await db
    .insert(customFieldDefinitions)
    .values({ workspaceId, entityType: 'contact', key, label: input.label.trim(), fieldType: input.fieldType })
    .onConflictDoNothing()
    .returning()
  if (row) return { id: row.id, label: row.label, fieldType: row.fieldType }
  const [existing] = await db
    .select()
    .from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.workspaceId, workspaceId), eq(customFieldDefinitions.entityType, 'contact'), eq(customFieldDefinitions.key, key)))
    .limit(1)
  if (!existing) throw new AppError(409, 'A field with that name already exists')
  return { id: existing.id, label: existing.label, fieldType: existing.fieldType }
}

export async function setCustomValue(db: Database, userId: string, workspaceId: string, contactId: string, definitionId: string, input: z.infer<typeof customValueSchema>) {
  await writer(db, userId, workspaceId)
  await getContact(db, userId, workspaceId, contactId)
  const [definition] = await db.select().from(customFieldDefinitions).where(and(eq(customFieldDefinitions.id, definitionId), eq(customFieldDefinitions.workspaceId, workspaceId))).limit(1)
  if (!definition) throw new AppError(404, 'Field not found')
  const [existing] = await db.select().from(customFieldValues).where(and(eq(customFieldValues.definitionId, definitionId), eq(customFieldValues.entityId, contactId))).limit(1)
  if (input.value === null || input.value === '') {
    if (existing) await db.delete(customFieldValues).where(eq(customFieldValues.id, existing.id))
    return { ok: true }
  }
  if (existing) {
    await db.update(customFieldValues).set({ value: input.value, updatedAt: new Date() }).where(eq(customFieldValues.id, existing.id))
  } else {
    await db.insert(customFieldValues).values({ definitionId, entityId: contactId, value: input.value })
  }
  return { ok: true }
}

export async function agenda(db: Database, userId: string, workspaceId: string) {
  await reader(db, userId, workspaceId)
  const people = await db
    .select({
      id: contacts.id,
      displayName: contacts.displayName,
      birthday: contacts.birthday,
      anniversary: contacts.anniversary,
      followUpFrequency: contacts.followUpFrequency,
      lastInteractionAt: contacts.lastInteractionAt,
    })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
  const dates = []
  for (const person of people) {
    for (const kind of ['birthday', 'anniversary'] as const) {
      const value = person[kind]
      if (!value) continue
      const next = nextOccurrence(value)
      if (next === null || next > 45) continue
      dates.push({ contactId: person.id, displayName: person.displayName, kind, date: value, days: next })
    }
  }
  dates.sort((left, right) => left.days - right.days)
  const openTasks = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt), isNull(tasks.completedAt), taskVisibleSql(userId), taskContactSql(userId)))
    .orderBy(asc(tasks.dueAt))
    .limit(20)
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const upcoming = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.workspaceId, workspaceId), isNull(reminders.completedAt), lte(reminders.remindAt, soon), or(isNull(reminders.snoozedUntil), lte(reminders.snoozedUntil, new Date())), reminderContactSql(userId)))
    .orderBy(asc(reminders.remindAt))
    .limit(20)
  const reachOuts = []
  for (const person of people) {
    const cadence = person.followUpFrequency ? cadenceDays[person.followUpFrequency] : undefined
    if (!cadence) continue
    const daysSince = person.lastInteractionAt ? Math.floor((Date.now() - person.lastInteractionAt.getTime()) / 86_400_000) : null
    if (daysSince !== null && daysSince < cadence.days) continue
    reachOuts.push({
      contactId: person.id,
      displayName: person.displayName,
      daysSince,
      label: daysSince === null ? `Reach out to ${person.displayName} · ${cadence.label}` : `Reach out to ${person.displayName} · ${daysSince} days since you last spoke`,
    })
  }
  reachOuts.sort((left, right) => (right.daysSince ?? 10_000) - (left.daysSince ?? 10_000))
  return {
    dates,
    tasks: openTasks.map(presentTask),
    reminders: upcoming.map((row) => ({ id: row.id, type: row.type, remindAt: row.remindAt.toISOString(), contactId: row.contactId })),
    reachOuts: reachOuts.slice(0, 20),
  }
}

function nextOccurrence(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thisYear = new Date(today.getFullYear(), month - 1, day)
  const target = thisYear < today ? new Date(today.getFullYear() + 1, month - 1, day) : thisYear
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

async function attachActivityPeople(db: Database, rows: Array<typeof activities.$inferSelect>) {
  if (!rows.length) return []
  const people = await db
    .select({ activityId: activityContacts.activityId, contactId: contacts.id, displayName: contacts.displayName })
    .from(activityContacts)
    .innerJoin(contacts, eq(contacts.id, activityContacts.contactId))
    .where(inArray(activityContacts.activityId, rows.map((row) => row.id)))
  const presented = rows.map((row) => ({
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    description: row.description,
    location: row.location,
    visibility: row.visibility,
    people: people.filter((person) => person.activityId === row.id).map(({ activityId: _id, ...person }) => person),
  }))
  return attachFiles(db, presented, 'activity')
}

function presentRelationshipType(row: typeof relationshipTypes.$inferSelect) {
  return { id: row.id, label: row.label, reciprocalLabel: row.reciprocalLabel }
}

function presentOrganization(row: typeof organizations.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    website: row.website,
    email: row.email,
    phone: row.phone,
    city: row.city,
    logoUrl: organizationLogoUrl(row.website),
  }
}

function patchOrg(input: z.infer<typeof organizationSchema>) {
  const values: {
    name: string
    industry?: string | null
    website?: string | null
    email?: string | null
    phone?: string | null
    street?: string | null
    city?: string | null
    region?: string | null
    postalCode?: string | null
    country?: string | null
    notes?: string | null
  } = { name: input.name.trim() }
  const keys = ['industry', 'website', 'email', 'phone', 'street', 'city', 'region', 'postalCode', 'country', 'notes'] as const
  for (const key of keys) {
    if (input[key] !== undefined) values[key] = input[key]?.trim() || null
  }
  return values
}

function presentNote(row: typeof notes.$inferSelect) {
  return { id: row.id, body: row.body, visibility: row.visibility, authorId: row.authorId, contactId: row.contactId, createdAt: row.createdAt.toISOString() }
}

type FileInfo = { id: string; filename: string; contentType: string }

async function attachFiles<T extends { id: string }>(db: Database, rows: T[], parent: 'note' | 'activity') {
  if (!rows.length) return rows.map((row) => ({ ...row, files: [] as FileInfo[] }))
  const column = parent === 'note' ? interactionFiles.noteId : interactionFiles.activityId
  const stored = await db
    .select({ parentId: column, id: attachments.id, filename: attachments.filename, contentType: attachments.contentType })
    .from(interactionFiles)
    .innerJoin(attachments, eq(attachments.id, interactionFiles.attachmentId))
    .where(inArray(column, rows.map((row) => row.id)))
  const grouped = new Map<string, FileInfo[]>()
  for (const file of stored) {
    if (!file.parentId) continue
    const list = grouped.get(file.parentId) ?? []
    list.push({ id: file.id, filename: file.filename, contentType: file.contentType })
    grouped.set(file.parentId, list)
  }
  return rows.map((row) => ({ ...row, files: grouped.get(row.id) ?? [] }))
}

export async function assertCanAttach(db: Database, userId: string, workspaceId: string, target: { noteId?: string; activityId?: string }) {
  if (target.noteId) {
    const [row] = await db.select().from(notes).where(and(eq(notes.id, target.noteId), eq(notes.workspaceId, workspaceId), isNull(notes.deletedAt))).limit(1)
    if (!row || !visible(userId, row.visibility, row.authorId)) throw new AppError(404, 'Note not found')
    if (row.contactId) await requireContactWrite(db, userId, workspaceId, row.contactId)
    else await writer(db, userId, workspaceId)
    return
  }
  if (target.activityId) {
    const [row] = await db.select().from(activities).where(and(eq(activities.id, target.activityId), eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt))).limit(1)
    if (!row || !visible(userId, row.visibility, row.createdBy)) throw new AppError(404, 'Interaction not found')
    const people = await db.select({ contactId: activityContacts.contactId }).from(activityContacts).where(eq(activityContacts.activityId, row.id))
    if (people.length) {
      for (const person of people) await requireContactWrite(db, userId, workspaceId, person.contactId)
    } else await writer(db, userId, workspaceId)
    return
  }
  throw new AppError(400, 'Choose an interaction')
}

export async function linkInteractionFile(db: Database, userId: string, workspaceId: string, target: { noteId?: string; activityId?: string }, attachmentId: string) {
  await assertCanAttach(db, userId, workspaceId, target)
  await db.insert(interactionFiles).values({ attachmentId, noteId: target.noteId ?? null, activityId: target.activityId ?? null })
  const [file] = await db.select({ id: attachments.id, filename: attachments.filename, contentType: attachments.contentType }).from(attachments).where(eq(attachments.id, attachmentId)).limit(1)
  if (!file) throw new AppError(500, 'Could not store the file')
  return file
}

export async function unlinkInteractionFile(db: Database, userId: string, workspaceId: string, attachmentId: string) {
  const file = await readableInteractionFile(db, userId, workspaceId, attachmentId)
  await assertCanAttach(db, userId, workspaceId, { noteId: file.noteId ?? undefined, activityId: file.activityId ?? undefined })
  await db.delete(interactionFiles).where(eq(interactionFiles.attachmentId, attachmentId))
  return file.attachmentId
}

export async function readableInteractionFile(db: Database, userId: string, workspaceId: string, attachmentId: string) {
  const [link] = await db
    .select({
      attachmentId: attachments.id,
      storageKey: attachments.storageKey,
      filename: attachments.filename,
      contentType: attachments.contentType,
      noteId: interactionFiles.noteId,
      activityId: interactionFiles.activityId,
    })
    .from(interactionFiles)
    .innerJoin(attachments, eq(attachments.id, interactionFiles.attachmentId))
    .where(and(eq(interactionFiles.attachmentId, attachmentId), eq(attachments.workspaceId, workspaceId)))
    .limit(1)
  if (!link) throw new AppError(404, 'File not found')
  if (link.noteId) {
    const [row] = await db.select().from(notes).where(and(eq(notes.id, link.noteId), eq(notes.workspaceId, workspaceId), isNull(notes.deletedAt))).limit(1)
    if (!row || !visible(userId, row.visibility, row.authorId)) throw new AppError(404, 'File not found')
    if (row.contactId) await getContact(db, userId, workspaceId, row.contactId)
    else await reader(db, userId, workspaceId)
  } else if (link.activityId) {
    const [row] = await db.select().from(activities).where(and(eq(activities.id, link.activityId), eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt))).limit(1)
    if (!row || !visible(userId, row.visibility, row.createdBy)) throw new AppError(404, 'File not found')
    const people = await db.select({ contactId: activityContacts.contactId }).from(activityContacts).where(eq(activityContacts.activityId, row.id))
    if (people.length) {
      let allowed = false
      for (const person of people) {
        try {
          await getContact(db, userId, workspaceId, person.contactId)
          allowed = true
          break
        } catch {
          allowed = false
        }
      }
      if (!allowed) throw new AppError(404, 'File not found')
    } else await reader(db, userId, workspaceId)
  }
  return link
}

export async function listWorkspaceNotes(db: Database, userId: string, workspaceId: string) {
  await reader(db, userId, workspaceId)
  const rows = await db
    .select({ note: notes, contactName: contacts.displayName })
    .from(notes)
    .leftJoin(contacts, eq(contacts.id, notes.contactId))
    .where(and(eq(notes.workspaceId, workspaceId), isNull(notes.deletedAt)))
    .orderBy(desc(notes.createdAt))
    .limit(100)
  const visibleNotes = rows
    .filter((row) => visible(userId, row.note.visibility, row.note.authorId))
    .map((row) => ({ ...presentNote(row.note), contactName: row.contactName }))
  return attachFiles(db, visibleNotes, 'note')
}

function presentTask(row: typeof tasks.$inferSelect) {
  return {
    id: row.id,
    uid: row.uid,
    title: row.title,
    visibility: row.visibility,
    dueAt: row.dueAt?.toISOString() ?? null,
    priority: row.priority,
    notes: row.notes ?? '',
    rrule: row.rrule,
    completedAt: row.completedAt?.toISOString() ?? null,
    contactId: row.contactId,
  }
}

function taskVisibleSql(userId: string) {
  return sql`(${tasks.visibility} <> 'private' or ${tasks.createdBy} = ${userId} or ${tasks.assigneeId} = ${userId})`
}

function reminderContactSql(userId: string) {
  return sql`(
    ${reminders.contactId} is null
    or exists (
      select 1 from contacts c
      where c.id = ${reminders.contactId}
      and c.deleted_at is null
      and (
        c.visibility <> 'restricted'
        or c.owner_id = ${userId}
        or exists (select 1 from contact_grants g where g.contact_id = c.id and g.user_id = ${userId})
        or exists (
          select 1 from contact_group_grants cg
          inner join user_group_members gm on gm.group_id = cg.group_id
          where cg.contact_id = c.id and gm.user_id = ${userId}
        )
        or exists (select 1 from workspace_members wm where wm.workspace_id = c.workspace_id and wm.user_id = ${userId} and wm.role in ('owner', 'administrator'))
      )
    )
  )`
}

function taskContactSql(userId: string) {
  return sql`(
    ${tasks.contactId} is null
    or exists (
      select 1 from contacts c
      where c.id = ${tasks.contactId}
      and c.deleted_at is null
      and (
        c.visibility <> 'restricted'
        or c.owner_id = ${userId}
        or exists (select 1 from contact_grants g where g.contact_id = c.id and g.user_id = ${userId})
        or exists (
          select 1 from contact_group_grants cg
          inner join user_group_members gm on gm.group_id = cg.group_id
          where cg.contact_id = c.id and gm.user_id = ${userId}
        )
        or exists (select 1 from workspace_members wm where wm.workspace_id = c.workspace_id and wm.user_id = ${userId} and wm.role in ('owner', 'administrator'))
      )
    )
  )`
}

async function readableTask(db: Database, userId: string, workspaceId: string, taskId: string) {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt))).limit(1)
  if (!row) throw new AppError(404, 'Task not found')
  const shared = row.visibility !== 'private' || row.createdBy === userId || row.assigneeId === userId
  if (!shared) throw new AppError(404, 'Task not found')
  if (row.contactId) await getContact(db, userId, workspaceId, row.contactId)
  else await reader(db, userId, workspaceId)
  return row
}

function orgValues(input: z.infer<typeof organizationSchema>) {
  return {
    name: input.name.trim(),
    industry: input.industry ?? null,
    website: input.website ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    street: input.street ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? null,
    notes: input.notes ?? null,
  }
}

async function assertOrganization(db: Database, workspaceId: string, organizationId: string) {
  const [row] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId), isNull(organizations.deletedAt))).limit(1)
  if (!row) throw new AppError(404, 'Organization not found')
}
