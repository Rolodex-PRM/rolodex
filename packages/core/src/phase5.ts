import {
  activities,
  activityContacts,
  addresses,
  attachments,
  contactDates,
  contactExternalIdentities,
  contactGrants,
  contactGroupGrants,
  contactMethods,
  contactTags,
  contacts,
  customFieldValues,
  householdMembers,
  interactionFiles,
  notes,
  organizationMemberships,
  relationshipDismissals,
  relationships,
  reminders,
  tasks,
  type Database,
} from '@rolodex/db'
import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { requireMembership } from './access'
import { storedEventsInMonth, datesInMonth } from './calendar'
import { deleteContact, requireContactWrite, visibleContactSql, writeAudit } from './contacts'
import { AppError } from './errors'
import { syncInferredRelationships } from './crm'

const mailHosts = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'fastmail.com'])
const familyTypes = new Set(['spouse', 'parent', 'child', 'sibling', 'grandparent', 'grandchild', 'aunt/uncle', 'niece/nephew', 'cousin', 'boyfriend/girlfriend'])

export type DuplicatePerson = { id: string; name: string; emails: string[]; phones: string[] }
export type DuplicateGroup = { reason: 'email' | 'phone' | 'name'; contactIds: string[] }

export function groupDuplicates(people: DuplicatePerson[]): DuplicateGroup[] {
  const used = new Set<string>()
  const groups: DuplicateGroup[] = []
  const collect = (reason: DuplicateGroup['reason'], keys: (person: DuplicatePerson) => string[]) => {
    const buckets = new Map<string, string[]>()
    for (const person of people) {
      for (const key of keys(person)) {
        if (!key) continue
        const list = buckets.get(key) ?? []
        list.push(person.id)
        buckets.set(key, list)
      }
    }
    for (const ids of buckets.values()) {
      const fresh = [...new Set(ids)].filter((id) => !used.has(id))
      if (fresh.length < 2) continue
      for (const id of fresh) used.add(id)
      groups.push({ reason, contactIds: fresh })
    }
  }
  collect('email', (person) => person.emails.map((value) => value.trim().toLowerCase()))
  collect('phone', (person) => person.phones.map(phoneKey).filter((value) => value.length >= 10))
  collect('name', (person) => {
    const name = person.name.trim().toLowerCase().replace(/\s+/g, ' ')
    return name.split(' ').length >= 2 ? [name] : []
  })
  return groups
}

export function enrichFromEmail(email: string, organization: string | null, website: string | null) {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? ''
  if (!domain || mailHosts.has(domain) || domain.includes('example.')) return { organizationName: null as string | null, website: null as string | null }
  const stem = domain.split('.')[0] ?? ''
  const organizationName = organization?.trim() ? null : stem.split(/[-_]/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ')
  const site = website?.trim() ? null : `https://${domain}`
  return { organizationName, website: site }
}

export function buildSummary(input: {
  name: string
  organization: string | null
  relationships: { type: string; name: string }[]
  lastInteractionAt: string | null
  notes: string[]
  activityCount: number
}) {
  const lines = [`${input.name}${input.organization ? ` at ${input.organization}` : ''} has ${input.activityCount} logged interaction${input.activityCount === 1 ? '' : 's'}.`]
  if (input.lastInteractionAt) lines.push(`The latest one was ${input.lastInteractionAt.slice(0, 10)}.`)
  else lines.push('Nothing is logged yet.')
  const counts = new Map<string, number>()
  for (const link of input.relationships) counts.set(link.type, (counts.get(link.type) ?? 0) + 1)
  if (counts.size) {
    const parts = [...counts.entries()].slice(0, 4).map(([type, count]) => `${count} ${type}`)
    lines.push(`Connections: ${parts.join(', ')}.`)
  }
  const note = input.notes.find((body) => body.trim())
  if (note) lines.push(`A recent note starts: ${note.trim().slice(0, 140)}`)
  return lines.join(' ')
}

function phoneKey(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

export async function findDuplicates(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const people = await db
    .select({ id: contacts.id, name: contacts.displayName })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
  const ids = people.map((person) => person.id)
  const methods = ids.length ? await db.select().from(contactMethods).where(inArray(contactMethods.contactId, ids)) : []
  const grouped = groupDuplicates(people.map((person) => ({
    id: person.id,
    name: person.name,
    emails: methods.filter((method) => method.contactId === person.id && method.kind === 'email').map((method) => method.value),
    phones: methods.filter((method) => method.contactId === person.id && method.kind === 'phone').map((method) => method.value),
  })))
  const names = new Map(people.map((person) => [person.id, person.name]))
  return grouped.map((group) => ({
    reason: group.reason,
    contacts: group.contactIds.map((id) => ({ id, displayName: names.get(id) ?? 'Contact' })),
  }))
}

export async function mergeContacts(db: Database, userId: string, workspaceId: string, keepId: string, duplicateId: string) {
  if (keepId === duplicateId) throw new AppError(400, 'Choose two different people')
  await requireContactWrite(db, userId, workspaceId, keepId)
  await requireContactWrite(db, userId, workspaceId, duplicateId)
  const [keep] = await db.select().from(contacts).where(and(eq(contacts.id, keepId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt))).limit(1)
  const [duplicate] = await db.select().from(contacts).where(and(eq(contacts.id, duplicateId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt))).limit(1)
  if (!keep || !duplicate) throw new AppError(404, 'Contact not found')
  await db.transaction(async (tx) => {
    const database = tx as unknown as Database
    await moveMethods(database, keepId, duplicateId)
    await database.update(addresses).set({ contactId: keepId }).where(eq(addresses.contactId, duplicateId))
    await moveTags(database, keepId, duplicateId)
    await moveMemberships(database, keepId, duplicateId)
    await moveGrants(database, keepId, duplicateId)
    await moveGroupGrants(database, keepId, duplicateId)
    await moveHouseholds(database, keepId, duplicateId)
    await moveActivities(database, keepId, duplicateId)
    await database.update(notes).set({ contactId: keepId }).where(eq(notes.contactId, duplicateId))
    await database.update(tasks).set({ contactId: keepId }).where(eq(tasks.contactId, duplicateId))
    await database.update(reminders).set({ contactId: keepId }).where(eq(reminders.contactId, duplicateId))
    await database.update(contactDates).set({ contactId: keepId }).where(eq(contactDates.contactId, duplicateId))
    await database.update(contactExternalIdentities).set({ contactId: keepId }).where(eq(contactExternalIdentities.contactId, duplicateId))
    await moveCustomValues(database, keepId, duplicateId)
    await moveRelationships(database, keepId, duplicateId)
    if (duplicate.cardNote?.trim() && duplicate.cardNote.trim() !== keep.cardNote?.trim()) {
      await database.insert(notes).values({ workspaceId, contactId: keepId, authorId: userId, body: `Merged card note:\n${duplicate.cardNote.trim()}`, visibility: 'workspace' })
    }
    const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() }
    for (const field of ['organizationName', 'title', 'website', 'birthday', 'anniversary', 'howWeMet', 'interests', 'followUpFrequency'] as const) {
      if (!keep[field] && duplicate[field]) patch[field] = duplicate[field]
    }
    if (!keep.photoAttachmentId && duplicate.photoAttachmentId) patch.photoAttachmentId = duplicate.photoAttachmentId
    if (!keep.coverAttachmentId && duplicate.coverAttachmentId) {
      patch.coverAttachmentId = duplicate.coverAttachmentId
      patch.coverMode = duplicate.coverMode
    }
    const keepTime = keep.lastInteractionAt?.getTime() ?? 0
    const duplicateTime = duplicate.lastInteractionAt?.getTime() ?? 0
    if (duplicateTime > keepTime) patch.lastInteractionAt = duplicate.lastInteractionAt
    await database.update(contacts).set(patch).where(eq(contacts.id, keepId))
    await database.update(contacts).set({ introducedByContactId: keepId }).where(eq(contacts.introducedByContactId, duplicateId))
    await writeAudit(database, workspaceId, userId, 'contact.merge', keepId)
  })
  await syncInferredRelationships(db, workspaceId)
  await deleteContact(db, userId, workspaceId, duplicateId)
  return { ok: true, contactId: keepId }
}

async function moveMethods(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(contactMethods).where(inArray(contactMethods.contactId, [keepId, duplicateId]))
  const owned = new Set(rows.filter((row) => row.contactId === keepId).map((row) => `${row.kind}:${row.normalizedValue}`))
  for (const row of rows.filter((item) => item.contactId === duplicateId)) {
    const key = `${row.kind}:${row.normalizedValue}`
    if (owned.has(key)) await db.delete(contactMethods).where(eq(contactMethods.id, row.id))
    else {
      await db.update(contactMethods).set({ contactId: keepId, isPrimary: false }).where(eq(contactMethods.id, row.id))
      owned.add(key)
    }
  }
}

async function moveTags(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(contactTags).where(inArray(contactTags.contactId, [keepId, duplicateId]))
  const owned = new Set(rows.filter((row) => row.contactId === keepId).map((row) => row.tagId))
  for (const row of rows.filter((item) => item.contactId === duplicateId)) {
    if (owned.has(row.tagId)) await db.delete(contactTags).where(and(eq(contactTags.contactId, duplicateId), eq(contactTags.tagId, row.tagId)))
    else await db.update(contactTags).set({ contactId: keepId }).where(and(eq(contactTags.contactId, duplicateId), eq(contactTags.tagId, row.tagId)))
  }
}

async function moveMemberships(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(organizationMemberships).where(eq(organizationMemberships.contactId, duplicateId))
  for (const row of rows) {
    const clash = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.contactId, keepId), eq(organizationMemberships.organizationId, row.organizationId))).limit(1)
    if (clash.length) await db.delete(organizationMemberships).where(eq(organizationMemberships.id, row.id))
    else await db.update(organizationMemberships).set({ contactId: keepId }).where(eq(organizationMemberships.id, row.id))
  }
}

async function moveGrants(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(contactGrants).where(eq(contactGrants.contactId, duplicateId))
  for (const row of rows) {
    const clash = await db.select().from(contactGrants).where(and(eq(contactGrants.contactId, keepId), eq(contactGrants.userId, row.userId))).limit(1)
    if (clash.length) await db.delete(contactGrants).where(eq(contactGrants.id, row.id))
    else await db.update(contactGrants).set({ contactId: keepId }).where(eq(contactGrants.id, row.id))
  }
}

async function moveGroupGrants(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(contactGroupGrants).where(eq(contactGroupGrants.contactId, duplicateId))
  for (const row of rows) {
    const clash = await db.select().from(contactGroupGrants).where(and(eq(contactGroupGrants.contactId, keepId), eq(contactGroupGrants.groupId, row.groupId))).limit(1)
    if (clash.length) await db.delete(contactGroupGrants).where(eq(contactGroupGrants.id, row.id))
    else await db.update(contactGroupGrants).set({ contactId: keepId }).where(eq(contactGroupGrants.id, row.id))
  }
}

async function moveHouseholds(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(householdMembers).where(eq(householdMembers.contactId, duplicateId))
  for (const row of rows) {
    const clash = await db.select().from(householdMembers).where(and(eq(householdMembers.contactId, keepId), eq(householdMembers.householdId, row.householdId))).limit(1)
    if (clash.length) await db.delete(householdMembers).where(eq(householdMembers.id, row.id))
    else await db.update(householdMembers).set({ contactId: keepId }).where(eq(householdMembers.id, row.id))
  }
}

async function moveActivities(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(activityContacts).where(eq(activityContacts.contactId, duplicateId))
  for (const row of rows) {
    const clash = await db.select().from(activityContacts).where(and(eq(activityContacts.activityId, row.activityId), eq(activityContacts.contactId, keepId))).limit(1)
    if (clash.length) await db.delete(activityContacts).where(and(eq(activityContacts.activityId, row.activityId), eq(activityContacts.contactId, duplicateId)))
    else await db.update(activityContacts).set({ contactId: keepId }).where(and(eq(activityContacts.activityId, row.activityId), eq(activityContacts.contactId, duplicateId)))
  }
}

async function moveCustomValues(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(customFieldValues).where(eq(customFieldValues.entityId, duplicateId))
  for (const row of rows) {
    const clash = await db.select().from(customFieldValues).where(and(eq(customFieldValues.definitionId, row.definitionId), eq(customFieldValues.entityId, keepId))).limit(1)
    if (clash.length) await db.delete(customFieldValues).where(eq(customFieldValues.id, row.id))
    else await db.update(customFieldValues).set({ entityId: keepId }).where(eq(customFieldValues.id, row.id))
  }
}

async function moveRelationships(db: Database, keepId: string, duplicateId: string) {
  const rows = await db.select().from(relationships).where(or(eq(relationships.fromContactId, duplicateId), eq(relationships.toContactId, duplicateId)))
  for (const row of rows) {
    const from = row.fromContactId === duplicateId ? keepId : row.fromContactId
    const to = row.toContactId === duplicateId ? keepId : row.toContactId
    if (from === to) {
      await db.delete(relationships).where(eq(relationships.id, row.id))
      continue
    }
    const clash = await db.select().from(relationships).where(and(eq(relationships.fromContactId, from), eq(relationships.toContactId, to), sql`lower(${relationships.type}) = ${row.type.toLowerCase()}`)).limit(1)
    if (clash.length) await db.delete(relationships).where(eq(relationships.id, row.id))
    else await db.update(relationships).set({ fromContactId: from, toContactId: to }).where(eq(relationships.id, row.id))
  }
  const dismissed = await db.select().from(relationshipDismissals).where(or(eq(relationshipDismissals.fromContactId, duplicateId), eq(relationshipDismissals.toContactId, duplicateId)))
  for (const row of dismissed) {
    const from = row.fromContactId === duplicateId ? keepId : row.fromContactId
    const to = row.toContactId === duplicateId ? keepId : row.toContactId
    if (from === to) {
      await db.delete(relationshipDismissals).where(eq(relationshipDismissals.id, row.id))
      continue
    }
    const clash = await db.select().from(relationshipDismissals).where(and(eq(relationshipDismissals.fromContactId, from), eq(relationshipDismissals.toContactId, to), sql`lower(${relationshipDismissals.type}) = ${row.type.toLowerCase()}`)).limit(1)
    if (clash.length) await db.delete(relationshipDismissals).where(eq(relationshipDismissals.id, row.id))
    else await db.update(relationshipDismissals).set({ fromContactId: from, toContactId: to }).where(eq(relationshipDismissals.id, row.id))
  }
}

export async function workspaceNetwork(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const people = await db
    .select({ id: contacts.id, name: contacts.displayName, followUpFrequency: contacts.followUpFrequency, lastInteractionAt: contacts.lastInteractionAt, birthday: contacts.birthday })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
  const edges = people.length
    ? await db
        .select({ id: relationships.id, from: relationships.fromContactId, to: relationships.toContactId, type: relationships.type, origin: relationships.origin })
        .from(relationships)
        .where(eq(relationships.workspaceId, workspaceId))
    : []
  const visible = new Set(people.map((person) => person.id))
  const links = edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to) && edge.from < edge.to)
  const degree = new Map<string, number>()
  for (const person of people) degree.set(person.id, 0)
  for (const edge of links) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const ranked = [...people].sort((left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0))
  const isolated = people.filter((person) => (degree.get(person.id) ?? 0) === 0)
  const busiest = ranked[0]
  const coworkers = links.filter((edge) => edge.type.toLowerCase() === 'coworker')
  const family = new Set(links.filter((edge) => familyTypes.has(edge.type.toLowerCase())).flatMap((edge) => [edge.from, edge.to]))
  const insights = [
    busiest && (degree.get(busiest.id) ?? 0) > 0 ? `${busiest.name} is connected to ${degree.get(busiest.id)} people.` : 'No one is linked yet.',
    `${isolated.length} ${isolated.length === 1 ? 'person has' : 'people have'} no relationships.`,
    family.size ? `${family.size} people are in a family connection.` : 'No family connections yet.',
    coworkers.length ? `${new Set(coworkers.flatMap((edge) => [edge.from, edge.to])).size} people are tied together as coworkers.` : 'No coworker groups yet.',
  ]
  const followUps = suggestFollowUps(people)
  return {
    nodes: ranked.map((person) => ({ id: person.id, name: person.name, degree: degree.get(person.id) ?? 0 })),
    edges: links.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type, inferred: edge.origin === 'inferred' })),
    insights,
    followUps,
  }
}

function suggestFollowUps(people: { id: string; name: string; followUpFrequency: string | null; lastInteractionAt: Date | null; birthday: string | null }[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const suggestions = []
  for (const person of people) {
    if (person.birthday) {
      const days = daysUntil(person.birthday, today)
      if (days != null && days <= 14) suggestions.push({ contactId: person.id, displayName: person.name, reason: days === 0 ? 'Birthday today' : `Birthday in ${days} ${days === 1 ? 'day' : 'days'}` })
    }
    const cadence = person.followUpFrequency ? Number(person.followUpFrequency) : null
    const since = person.lastInteractionAt ? Math.floor((today.getTime() - person.lastInteractionAt.getTime()) / 86_400_000) : null
    if (cadence && (since === null || since >= cadence)) suggestions.push({ contactId: person.id, displayName: person.name, reason: since === null ? 'No interaction logged' : `${since} ${since === 1 ? 'day' : 'days'} since the last interaction` })
    else if (since != null && since >= 90) suggestions.push({ contactId: person.id, displayName: person.name, reason: `Quiet for ${since} ${since === 1 ? 'day' : 'days'}` })
  }
  return suggestions.slice(0, 20)
}

function daysUntil(iso: string, today: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  const thisYear = new Date(today.getFullYear(), month - 1, day)
  const target = thisYear < today ? new Date(today.getFullYear() + 1, month - 1, day) : thisYear
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

export async function egoNetwork(db: Database, userId: string, workspaceId: string, contactId: string) {
  const network = await workspaceNetwork(db, userId, workspaceId)
  const near = new Set<string>([contactId])
  for (const edge of network.edges) {
    if (edge.from === contactId) near.add(edge.to)
    if (edge.to === contactId) near.add(edge.from)
  }
  const wider = new Set(near)
  for (const edge of network.edges) {
    if (near.has(edge.from)) wider.add(edge.to)
    if (near.has(edge.to)) wider.add(edge.from)
  }
  return {
    nodes: network.nodes.filter((node) => wider.has(node.id)),
    edges: network.edges.filter((edge) => wider.has(edge.from) && wider.has(edge.to)),
  }
}

export async function contactSummary(db: Database, userId: string, workspaceId: string, contactId: string) {
  await requireMembership(db, userId, workspaceId)
  const [person] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId))).limit(1)
  if (!person) throw new AppError(404, 'Contact not found')
  const links = await db
    .select({ type: relationships.type, name: contacts.displayName })
    .from(relationships)
    .innerJoin(contacts, eq(contacts.id, relationships.toContactId))
    .where(and(eq(relationships.fromContactId, contactId), isNull(contacts.deletedAt)))
  const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(activityContacts).innerJoin(activities, eq(activities.id, activityContacts.activityId)).where(and(eq(activityContacts.contactId, contactId), isNull(activities.deletedAt)))
  const recentNotes = await db.select({ body: notes.body }).from(notes).where(and(eq(notes.contactId, contactId), isNull(notes.deletedAt), or(eq(notes.visibility, 'workspace'), eq(notes.authorId, userId)))).limit(3)
  return {
    text: buildSummary({
      name: person.displayName,
      organization: person.organizationName,
      relationships: links,
      lastInteractionAt: person.lastInteractionAt?.toISOString() ?? null,
      notes: recentNotes.map((note) => note.body),
      activityCount: countRow?.total ?? 0,
    }),
  }
}

export async function enrichContact(db: Database, userId: string, workspaceId: string, contactId: string) {
  await requireContactWrite(db, userId, workspaceId, contactId)
  const [person] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt))).limit(1)
  if (!person) throw new AppError(404, 'Contact not found')
  const methods = await db.select().from(contactMethods).where(and(eq(contactMethods.contactId, contactId), eq(contactMethods.kind, 'email')))
  const email = methods.find((method) => method.isPrimary)?.value ?? methods[0]?.value
  if (!email) throw new AppError(400, 'Add an email address first')
  const next = enrichFromEmail(email, person.organizationName, person.website)
  const patch: Partial<typeof contacts.$inferInsert> = {}
  if (next.organizationName) patch.organizationName = next.organizationName
  if (next.website) patch.website = next.website
  if (!Object.keys(patch).length) return { changed: [] as string[] }
  await db.update(contacts).set({ ...patch, updatedAt: new Date() }).where(eq(contacts.id, contactId))
  await writeAudit(db, workspaceId, userId, 'contact.enrich', contactId)
  return { changed: Object.keys(patch) }
}

export async function calendarMonth(db: Database, userId: string, workspaceId: string, year: number, month: number) {
  await requireMembership(db, userId, workspaceId)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  const people = await db
    .select({ id: contacts.id, name: contacts.displayName, birthday: contacts.birthday, anniversary: contacts.anniversary })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
  const events: { date: string; kind: string; title: string; contactId: string | null; readOnly?: boolean }[] = []
  for (const person of people) {
    for (const [kind, value] of [['birthday', person.birthday], ['anniversary', person.anniversary]] as const) {
      const date = annualDate(value, year, month)
      if (date) events.push({ date, kind, title: `${person.name}'s ${kind}`, contactId: person.id })
    }
  }
  const dates = people.length ? await db.select().from(contactDates).where(inArray(contactDates.contactId, people.map((person) => person.id))) : []
  const names = new Map(people.map((person) => [person.id, person.name]))
  for (const row of dates) {
    const date = annualDate(row.occursOn, year, month)
    if (date) events.push({ date, kind: 'date', title: `${names.get(row.contactId) ?? 'Someone'} · ${row.label}`, contactId: row.contactId })
  }
  const due = await db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
  for (const task of due) {
    if (!task.dueAt) continue
    const anchor = task.dueAt.toISOString().slice(0, 10)
    for (const date of datesInMonth(anchor, task.rrule, year, month)) {
      events.push({ date, kind: 'task', title: task.title, contactId: task.contactId, readOnly: true })
    }
  }
  const logged = await db.select().from(activities).where(and(eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt), gte(activities.occurredAt, start), lt(activities.occurredAt, end), or(eq(activities.visibility, 'workspace'), eq(activities.createdBy, userId))))
  for (const activity of logged) {
    events.push({ date: activity.occurredAt.toISOString().slice(0, 10), kind: activity.type, title: activity.description?.trim() || activity.type, contactId: null })
  }
  const stored = await storedEventsInMonth(db, userId, workspaceId, year, month)
  const combined = [
    ...events.map((event) => ({
      description: '',
      location: '',
      status: 'CONFIRMED',
      priority: 0,
      rrule: null as string | null,
      url: '',
      allDay: true,
      startTime: null as string | null,
      endTime: null as string | null,
      endDate: event.date,
      readOnly: true,
      ...event,
      eventId: null as string | null,
    })),
    ...stored,
  ]
  combined.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title))
  return { year, month, events: combined }
}

function annualDate(value: string | null, year: number, month: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match || Number(match[2]) !== month) return null
  return `${year}-${match[2]}-${match[3]}`
}

export function calendarIcs(events: { date: string; kind: string; title: string }[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rolodex//Calendar//EN']
  for (const event of events) {
    const stamp = event.date.replace(/-/g, '')
    lines.push('BEGIN:VEVENT', `UID:${stamp}-${event.kind}-${event.title.length}@rolodex`, `DTSTART;VALUE=DATE:${stamp}`, `SUMMARY:${event.title.replace(/[\n,;]/g, ' ')}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export async function photoMemories(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const today = new Date()
  const month = today.getMonth() + 1
  const day = today.getDate()
  const rows = await db
    .select({
      activityId: activities.id,
      occurredAt: activities.occurredAt,
      description: activities.description,
      type: activities.type,
      attachmentId: interactionFiles.attachmentId,
      contactId: activityContacts.contactId,
      contactName: contacts.displayName,
    })
    .from(interactionFiles)
    .innerJoin(activities, eq(activities.id, interactionFiles.activityId))
    .innerJoin(attachments, eq(attachments.id, interactionFiles.attachmentId))
    .innerJoin(activityContacts, eq(activityContacts.activityId, activities.id))
    .innerJoin(contacts, eq(contacts.id, activityContacts.contactId))
    .where(and(
      eq(activities.workspaceId, workspaceId),
      isNull(activities.deletedAt),
      isNull(contacts.deletedAt),
      sql`${attachments.contentType} like 'image/%'`,
      sql`extract(month from ${activities.occurredAt}) = ${month}`,
      sql`extract(day from ${activities.occurredAt}) = ${day}`,
      or(eq(activities.visibility, 'workspace'), eq(activities.createdBy, userId)),
      visibleContactSql(userId),
    ))
    .limit(12)
  return rows.map((row) => ({
    activityId: row.activityId,
    attachmentId: row.attachmentId,
    contactId: row.contactId,
    contactName: row.contactName,
    year: row.occurredAt.getFullYear(),
    label: row.description?.trim() || row.type,
  }))
}
