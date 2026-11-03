import { randomUUID } from 'node:crypto'
import { calendarEvents, contactDates, contacts, tasks, type Database } from '@rolodex/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { requireMembership, requireWriter } from './access'
import { AppError } from './errors'
import { makeEtag } from './secrets'
import { visibleContactSql, writeAudit } from './contacts'
import { canWriteContacts } from './permissions'
import { listWorkspaces } from './workspaces'

export const eventTypes = ['meeting', 'call', 'meal', 'birthday', 'anniversary', 'task', 'personal', 'reminder'] as const
export type EventType = (typeof eventTypes)[number]
export const eventStatuses = ['CONFIRMED', 'TENTATIVE', 'CANCELLED'] as const
export type EventStatus = (typeof eventStatuses)[number]

export type CalendarItem = {
  id: string | null
  uid: string
  type: EventType
  summary: string
  description: string
  location: string
  status: EventStatus
  priority: number
  rrule: string | null
  url: string
  start: string
  end: string
  allDay: boolean
  contactId: string | null
  readOnly: boolean
  etag: string
  updatedAt: Date
}

export type MonthEvent = {
  date: string
  kind: string
  title: string
  contactId: string | null
  eventId: string | null
  description: string
  location: string
  status: string
  priority: number
  rrule: string | null
  url: string
  allDay: boolean
  startTime: string | null
  endTime: string | null
  endDate: string | null
  readOnly: boolean
}

export function isEventType(value: string): value is EventType {
  return (eventTypes as readonly string[]).includes(value)
}

export function isEventStatus(value: string): value is EventStatus {
  return (eventStatuses as readonly string[]).includes(value)
}

export function buildVevent(item: {
  uid: string
  type: string
  summary: string
  description: string
  start: string
  end: string
  allDay: boolean
  location?: string
  status?: string
  priority?: number
  rrule?: string | null
  url?: string | null
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rolodex//Calendar//EN',
    'BEGIN:VEVENT',
    `UID:${escapeText(item.uid)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `SUMMARY:${escapeText(item.summary)}`,
    `CATEGORIES:${item.type}`,
    `X-ROLODEX-TYPE:${item.type}`,
    `STATUS:${item.status || 'CONFIRMED'}`,
  ]
  if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`)
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`)
  if (item.url) lines.push(`URL:${escapeText(item.url)}`)
  if ((item.priority ?? 0) > 0) lines.push(`PRIORITY:${item.priority}`)
  if (item.rrule) lines.push(`RRULE:${item.rrule}`)
  if (item.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${item.start.slice(0, 10).replaceAll('-', '')}`)
    lines.push(`DTEND;VALUE=DATE:${item.end.slice(0, 10).replaceAll('-', '')}`)
  } else {
    lines.push(`DTSTART:${stamp(new Date(item.start))}`)
    lines.push(`DTEND:${stamp(new Date(item.end))}`)
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export function parseVevent(text: string) {
  const lines = unfold(text)
  const values = new Map<string, string>()
  for (const line of lines) {
    const split = line.indexOf(':')
    if (split < 0) continue
    const name = line.slice(0, split).split(';')[0]?.toUpperCase()
    if (name) values.set(name, line.slice(split + 1).replaceAll('\\n', '\n').replaceAll('\\,', ',').replaceAll('\\;', ';'))
  }
  const summary = values.get('SUMMARY')?.trim()
  const startRaw = lines.find((line) => line.toUpperCase().startsWith('DTSTART'))
  const endRaw = lines.find((line) => line.toUpperCase().startsWith('DTEND'))
  const start = startRaw ? readWhen(startRaw) : null
  if (!summary || !start) throw new AppError(400, 'The event needs a summary and a start')
  const end = endRaw ? readWhen(endRaw) : { ...start, date: addDays(start.date, start.allDay ? 1 : 0), instant: new Date(start.instant.getTime() + 60 * 60 * 1000) }
  const declared = (values.get('X-ROLODEX-TYPE') || values.get('CATEGORIES') || 'personal').split(',')[0]?.trim().toLowerCase() || 'personal'
  const status = (values.get('STATUS') || 'CONFIRMED').toUpperCase()
  return {
    type: isEventType(declared) ? declared : 'personal',
    summary: summary.slice(0, 200),
    description: values.get('DESCRIPTION')?.trim() || '',
    location: values.get('LOCATION')?.trim() || '',
    status: isEventStatus(status) ? status : 'CONFIRMED',
    priority: clampPriority(Number(values.get('PRIORITY') || 0)),
    rrule: cleanRule(values.get('RRULE')),
    url: values.get('URL')?.trim() || '',
    allDay: start.allDay,
    startAt: start.instant,
    endAt: end.instant,
    date: start.date,
  }
}

export async function calendarContext(db: Database, userId: string) {
  const rows = await listWorkspaces(db, userId)
  const workspace = rows.find((row) => row.role === 'owner') ?? rows[0]
  if (!workspace) throw new AppError(404, 'No workspace')
  return { workspaceId: workspace.id, canWrite: canWriteContacts(workspace.role) }
}

export async function listCalendarFeed(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const stored = await db.select().from(calendarEvents).where(eq(calendarEvents.workspaceId, workspaceId))
  const live = stored.filter((row) => !row.deletedAt).map(storedItem)
  const derived = await derivedItems(db, userId, workspaceId)
  const newest = stored.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0)
  return { items: [...live, ...derived], token: newest, stored }
}

export async function storedEventsInMonth(db: Database, userId: string, workspaceId: string, year: number, month: number) {
  await requireMembership(db, userId, workspaceId)
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.workspaceId, workspaceId), isNull(calendarEvents.deletedAt)))
  const events: MonthEvent[] = []
  for (const row of rows) {
    const anchor = row.allDay ? row.startAt.toISOString().slice(0, 10) : localDate(row.startAt)
    for (const date of datesInMonth(anchor, row.rrule, year, month)) {
      events.push(monthEvent(row, date))
    }
  }
  return events
}

export async function createCalendarEvent(
  db: Database,
  userId: string,
  workspaceId: string,
  input: EventInput,
) {
  await requireWriter(db, userId, workspaceId)
  const values = eventValues(input)
  const [row] = await db
    .insert(calendarEvents)
    .values({
      workspaceId,
      ownerId: userId,
      uid: randomUUID(),
      contactId: input.contactId || null,
      ...values,
    })
    .returning()
  if (!row) throw new AppError(500, 'Could not save the event')
  await writeAudit(db, workspaceId, userId, 'calendar.create', row.id, 'calendar_event', { type: row.type })
  return storedItem(row)
}

export async function updateCalendarEvent(db: Database, userId: string, workspaceId: string, eventId: string, input: EventInput) {
  await requireWriter(db, userId, workspaceId)
  const values = eventValues(input)
  const [row] = await db
    .update(calendarEvents)
    .set({ ...values, contactId: input.contactId || null, updatedAt: new Date() })
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.workspaceId, workspaceId), isNull(calendarEvents.deletedAt)))
    .returning()
  if (!row) throw new AppError(404, 'Event not found')
  await writeAudit(db, workspaceId, userId, 'calendar.update', row.id, 'calendar_event', { type: row.type })
  return storedItem(row)
}

export async function deleteCalendarEvent(db: Database, userId: string, workspaceId: string, eventId: string) {
  await requireWriter(db, userId, workspaceId)
  const [row] = await db
    .update(calendarEvents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.workspaceId, workspaceId), isNull(calendarEvents.deletedAt)))
    .returning()
  if (!row) throw new AppError(404, 'Event not found')
  await writeAudit(db, workspaceId, userId, 'calendar.delete', row.id, 'calendar_event', { type: row.type })
}

export async function upsertCalendarFromIcs(db: Database, userId: string, uid: string, body: string, ifMatch?: string | null) {
  const context = await calendarContext(db, userId)
  if (!context.canWrite) throw new AppError(403, 'This calendar is read only')
  if (isDerivedUid(uid)) throw new AppError(403, 'This event comes from a contact and stays read only')
  const parsed = parseVevent(body)
  const [existing] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.workspaceId, context.workspaceId), eq(calendarEvents.uid, uid)))
    .limit(1)
  if (existing && ifMatch && !ifMatch.includes('*') && !ifMatch.replaceAll('"', '').includes(makeEtag(buildVevent(storedItem(existing))))) {
    throw new AppError(412, 'The event changed. Refresh and try again.')
  }
  const values = {
    type: parsed.type,
    summary: parsed.summary,
    description: parsed.description || null,
    location: parsed.location || null,
    status: parsed.status,
    priority: parsed.priority,
    rrule: parsed.rrule,
    url: parsed.url || null,
    startAt: parsed.startAt,
    endAt: parsed.endAt,
    allDay: parsed.allDay,
    updatedAt: new Date(),
    deletedAt: null,
  }
  const card = {
    uid,
    type: parsed.type,
    summary: parsed.summary,
    description: parsed.description,
    location: parsed.location,
    status: parsed.status,
    priority: parsed.priority,
    rrule: parsed.rrule,
    url: parsed.url,
    start: parsed.startAt.toISOString(),
    end: parsed.endAt.toISOString(),
    allDay: parsed.allDay,
  }
  if (existing) {
    await db.update(calendarEvents).set(values).where(eq(calendarEvents.id, existing.id))
    return { created: false, etag: makeEtag(buildVevent(card)) }
  }
  await db.insert(calendarEvents).values({ workspaceId: context.workspaceId, ownerId: userId, uid, ...values })
  return { created: true, etag: makeEtag(buildVevent(card)) }
}

export async function deleteCalendarUid(db: Database, userId: string, uid: string) {
  const context = await calendarContext(db, userId)
  if (!context.canWrite) throw new AppError(403, 'This calendar is read only')
  if (isDerivedUid(uid)) throw new AppError(403, 'This event comes from a contact and stays read only')
  const [row] = await db
    .update(calendarEvents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(calendarEvents.workspaceId, context.workspaceId), eq(calendarEvents.uid, uid), isNull(calendarEvents.deletedAt)))
    .returning()
  if (!row) throw new AppError(404, 'Event not found')
}

export function isDerivedUid(uid: string) {
  return /^(bday|anniv|date)-/.test(uid)
}

function storedItem(row: typeof calendarEvents.$inferSelect): CalendarItem {
  const description = row.description ?? ''
  const item: CalendarItem = {
    id: row.id,
    uid: row.uid,
    type: isEventType(row.type) ? row.type : 'personal',
    summary: row.summary,
    description,
    location: row.location ?? '',
    status: isEventStatus(row.status) ? row.status : 'CONFIRMED',
    priority: row.priority,
    rrule: row.rrule,
    url: row.url ?? '',
    start: row.startAt.toISOString(),
    end: (row.endAt ?? new Date(row.startAt.getTime() + 86_400_000)).toISOString(),
    allDay: row.allDay,
    contactId: row.contactId,
    readOnly: false,
    etag: '',
    updatedAt: row.updatedAt,
  }
  item.etag = makeEtag(buildVevent(item))
  return item
}

async function derivedItems(db: Database, userId: string, workspaceId: string) {
  const people = await db
    .select({ id: contacts.id, name: contacts.displayName, birthday: contacts.birthday, anniversary: contacts.anniversary, updatedAt: contacts.updatedAt })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
  const items: CalendarItem[] = []
  for (const person of people) {
    if (person.birthday) items.push(annualItem(`bday-${person.id}`, 'birthday', `${person.name}'s birthday`, person.birthday, person.id, person.updatedAt))
    if (person.anniversary) items.push(annualItem(`anniv-${person.id}`, 'anniversary', `${person.name}'s anniversary`, person.anniversary, person.id, person.updatedAt))
  }
  const dates = people.length ? await db.select().from(contactDates).where(inArray(contactDates.contactId, people.map((person) => person.id))) : []
  const names = new Map(people.map((person) => [person.id, person.name]))
  for (const row of dates) {
    items.push(annualItem(`date-${row.id}`, 'personal', `${names.get(row.contactId) ?? 'Someone'} · ${row.label}`, row.occursOn, row.contactId, row.createdAt))
  }
  return items.filter((item) => item.summary)
}

function annualItem(uid: string, type: EventType, summary: string, iso: string, contactId: string, updatedAt: Date): CalendarItem {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  const month = match?.[2] ?? '01'
  const day = match?.[3] ?? '01'
  const year = new Date().getUTCFullYear()
  const start = `${year}-${month}-${day}`
  const item: CalendarItem = {
    id: null,
    uid,
    type,
    summary,
    description: '',
    location: '',
    status: 'CONFIRMED',
    priority: 0,
    rrule: null,
    url: '',
    start: `${start}T12:00:00.000Z`,
    end: `${addDays(start, 1)}T12:00:00.000Z`,
    allDay: true,
    contactId,
    readOnly: true,
    etag: '',
    updatedAt,
  }
  item.etag = makeEtag(buildVevent(item))
  return item
}

function dateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) throw new AppError(400, 'Use a date like 2026-11-03')
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
}

function readWhen(line: string) {
  const allDay = line.toUpperCase().includes('VALUE=DATE')
  const raw = line.slice(line.indexOf(':') + 1).trim()
  if (allDay || /^\d{8}$/.test(raw)) {
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    return { allDay: true, date, instant: new Date(`${date}T12:00:00.000Z`) }
  }
  const instant = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11) || '00'}:${raw.slice(11, 13) || '00'}:${raw.slice(13, 15) || '00'}Z`)
  return { allDay: false, date: instant.toISOString().slice(0, 10), instant }
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  const next = new Date(Date.UTC(year || 2026, (month || 1) - 1, day || 1))
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function stamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function escapeText(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;')
}

function unfold(text: string) {
  return text.replace(/\r\n[ \t]/g, '').replaceAll('\r\n', '\n').split('\n')
}

type EventInput = {
  type: string
  summary: string
  description?: string | null
  date: string
  endDate?: string | null
  allDay?: boolean
  startTime?: string | null
  endTime?: string | null
  location?: string | null
  status?: string | null
  priority?: number | null
  rrule?: string | null
  url?: string | null
  contactId?: string | null
}

function eventValues(input: EventInput) {
  if (!isEventType(input.type)) throw new AppError(400, 'Choose an event type')
  const summary = input.summary.trim()
  if (!summary) throw new AppError(400, 'The event needs a title')
  const allDay = input.allDay !== false
  const startAt = allDay ? dateOnly(input.date) : localInstant(input.date, input.startTime || '09:00')
  const endDate = input.endDate?.trim() || input.date
  const endAt = allDay ? dateOnly(addDays(endDate < input.date.slice(0, 10) ? input.date : endDate, 1)) : localInstant(endDate, input.endTime || '10:00')
  const status = (input.status || 'CONFIRMED').toUpperCase()
  return {
    type: input.type,
    summary: summary.slice(0, 200),
    description: input.description?.trim() || null,
    location: input.location?.trim() || null,
    status: isEventStatus(status) ? status : 'CONFIRMED',
    priority: clampPriority(input.priority ?? 0),
    rrule: cleanRule(input.rrule),
    url: input.url?.trim() || null,
    startAt,
    endAt: endAt.getTime() <= startAt.getTime() ? new Date(startAt.getTime() + (allDay ? 86_400_000 : 3_600_000)) : endAt,
    allDay,
  }
}

function monthEvent(row: typeof calendarEvents.$inferSelect, date: string): MonthEvent {
  const end = row.endAt ?? new Date(row.startAt.getTime() + 86_400_000)
  const endDate = row.allDay ? addDays(end.toISOString().slice(0, 10), -1) : localDate(end)
  return {
    date,
    kind: row.type,
    title: row.summary,
    contactId: row.contactId,
    eventId: row.id,
    description: row.description ?? '',
    location: row.location ?? '',
    status: row.status,
    priority: row.priority,
    rrule: row.rrule,
    url: row.url ?? '',
    allDay: row.allDay,
    startTime: row.allDay ? null : clock(row.startAt),
    endTime: row.allDay ? null : clock(end),
    endDate,
    readOnly: false,
  }
}

export function datesInMonth(start: string, rrule: string | null | undefined, year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return []
  const windowStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = new Date(Date.UTC(year, month, 0))
  if (Number.isNaN(monthEnd.getTime())) return []
  const windowEnd = monthEnd.toISOString().slice(0, 10)
  if (!rrule) return start >= windowStart && start <= windowEnd ? [start] : []
  const freq = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i.exec(rrule)?.[1]?.toUpperCase()
  if (!freq) return start >= windowStart && start <= windowEnd ? [start] : []
  const interval = Math.max(1, Number(/INTERVAL=(\d+)/i.exec(rrule)?.[1] || 1))
  const untilRaw = /UNTIL=(\d{8})/i.exec(rrule)?.[1]
  const until = untilRaw ? `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}` : '9999-12-31'
  const count = Number(/COUNT=(\d+)/i.exec(rrule)?.[1] || 0)
  const byday = new Set(
    (/BYDAY=([A-Z0-9,+-]+)/i.exec(rrule)?.[1] || '')
      .split(',')
      .map((part) => part.slice(-2).toUpperCase())
      .filter((part) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].includes(part)),
  )
  const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const found: string[] = []
  let seen = 0
  const origin = new Date(`${start}T00:00:00Z`)
  if (Number.isNaN(origin.getTime())) return []
  const cursor = new Date(origin)
  for (let guard = 0; guard < 800; guard += 1) {
    if (Number.isNaN(cursor.getTime())) break
    const iso = cursor.toISOString().slice(0, 10)
    if (iso > until || iso > windowEnd) break
    const days = Math.round((cursor.getTime() - origin.getTime()) / 86_400_000)
    const months = (cursor.getUTCFullYear() - origin.getUTCFullYear()) * 12 + cursor.getUTCMonth() - origin.getUTCMonth()
    const years = cursor.getUTCFullYear() - origin.getUTCFullYear()
    const weekday = names[cursor.getUTCDay()] || 'SU'
    let hit = false
    if (freq === 'DAILY') hit = days >= 0 && days % interval === 0
    else if (freq === 'WEEKLY' && byday.size) hit = days >= 0 && byday.has(weekday) && Math.floor(days / 7) % interval === 0
    else if (freq === 'WEEKLY') hit = days >= 0 && days % (7 * interval) === 0
    else if (freq === 'MONTHLY') hit = months >= 0 && months % interval === 0 && cursor.getUTCDate() === origin.getUTCDate()
    else hit = years >= 0 && years % interval === 0 && cursor.getUTCMonth() === origin.getUTCMonth() && cursor.getUTCDate() === origin.getUTCDate()
    if (hit) {
      seen += 1
      if (count && seen > count) break
      if (iso >= windowStart && iso >= start) found.push(iso)
    }
    if (freq === 'MONTHLY') cursor.setUTCMonth(cursor.getUTCMonth() + interval)
    else if (freq === 'YEARLY') cursor.setUTCFullYear(cursor.getUTCFullYear() + interval)
    else if (freq === 'WEEKLY' && !byday.size) cursor.setUTCDate(cursor.getUTCDate() + 7 * interval)
    else if (freq === 'DAILY') cursor.setUTCDate(cursor.getUTCDate() + interval)
    else cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return found
}

export type TodoItem = {
  uid: string
  summary: string
  notes: string
  due: string | null
  priority: number
  rrule: string | null
  completed: boolean
  etag: string
  updatedAt: Date
}

export function buildVtodo(item: { uid: string; summary: string; notes: string; due: string | null; priority: number; rrule: string | null; completed: boolean }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rolodex//Tasks//EN',
    'BEGIN:VTODO',
    `UID:${escapeText(item.uid)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `SUMMARY:${escapeText(item.summary)}`,
    `STATUS:${item.completed ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    `PRIORITY:${item.priority}`,
  ]
  if (item.notes) lines.push(`DESCRIPTION:${escapeText(item.notes)}`)
  if (item.rrule) lines.push(`RRULE:${item.rrule}`)
  if (item.due) lines.push(`DUE;VALUE=DATE:${item.due.slice(0, 10).replaceAll('-', '')}`)
  if (item.completed) lines.push(`COMPLETED:${stamp(new Date())}`)
  lines.push('END:VTODO', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export function parseVtodo(text: string) {
  if (!/BEGIN:VTODO/i.test(text)) throw new AppError(400, 'A task is required')
  const lines = unfold(text)
  const values = new Map<string, string>()
  let rule = ''
  for (const line of lines) {
    const split = line.indexOf(':')
    if (split < 0) continue
    const name = line.slice(0, split).split(';')[0]?.toUpperCase()
    if (name === 'RRULE') rule = line.slice(split + 1).trim()
    if (name) values.set(name, line.slice(split + 1).replaceAll('\\n', '\n').replaceAll('\\,', ',').replaceAll('\\;', ';'))
  }
  const summary = values.get('SUMMARY')?.trim()
  if (!summary) throw new AppError(400, 'The task needs a title')
  const dueLine = lines.find((line) => line.toUpperCase().startsWith('DUE'))
  const due = dueLine ? readWhen(dueLine).date : null
  const status = (values.get('STATUS') || 'NEEDS-ACTION').toUpperCase()
  return {
    summary: summary.slice(0, 200),
    notes: values.get('DESCRIPTION')?.trim() || '',
    due,
    priority: clampPriority(Number(values.get('PRIORITY') || 0)),
    rrule: cleanRule(rule || null),
    completed: status === 'COMPLETED',
  }
}

export async function listTodoFeed(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const rows = await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId))
  const visible = rows.filter((row) => row.visibility !== 'private' || row.createdBy === userId || row.assigneeId === userId)
  const live = visible.filter((row) => !row.deletedAt).map(todoItem)
  const newest = rows.reduce((max, row) => Math.max(max, row.updatedAt.getTime()), 0)
  return { items: live, token: newest, stored: visible }
}

export async function upsertTodoFromIcs(db: Database, userId: string, uid: string, body: string) {
  const context = await calendarContext(db, userId)
  if (!context.canWrite) throw new AppError(403, 'This calendar is read only')
  const parsed = parseVtodo(body)
  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.uid, uid)))
    .limit(1)
  const values = {
    title: parsed.summary,
    notes: parsed.notes || null,
    dueAt: parsed.due ? dateOnly(parsed.due) : null,
    priority: parsed.priority,
    rrule: parsed.rrule,
    completedAt: parsed.completed ? existing?.completedAt ?? new Date() : null,
    updatedAt: new Date(),
    deletedAt: null,
  }
  if (existing) {
    await db.update(tasks).set(values).where(eq(tasks.id, existing.id))
  } else {
    await db.insert(tasks).values({
      workspaceId: context.workspaceId,
      uid,
      visibility: 'workspace',
      createdBy: userId,
      assigneeId: userId,
      ...values,
    })
  }
  return { created: !existing, etag: makeEtag(buildVtodo({ uid, summary: parsed.summary, notes: parsed.notes, due: parsed.due, priority: parsed.priority, rrule: parsed.rrule, completed: parsed.completed })) }
}

export async function deleteTodoUid(db: Database, userId: string, uid: string) {
  const context = await calendarContext(db, userId)
  if (!context.canWrite) throw new AppError(403, 'This calendar is read only')
  const [row] = await db
    .update(tasks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.uid, uid), isNull(tasks.deletedAt)))
    .returning()
  if (!row) throw new AppError(404, 'Task not found')
}

function todoItem(row: typeof tasks.$inferSelect): TodoItem {
  const due = row.dueAt ? row.dueAt.toISOString().slice(0, 10) : null
  const item: TodoItem = {
    uid: row.uid,
    summary: row.title,
    notes: row.notes ?? '',
    due,
    priority: row.priority,
    rrule: row.rrule,
    completed: Boolean(row.completedAt),
    etag: '',
    updatedAt: row.updatedAt,
  }
  item.etag = makeEtag(buildVtodo(item))
  return item
}

function clampPriority(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(9, Math.round(value)))
}

function cleanRule(value: string | null | undefined) {
  const rule = value?.trim().toUpperCase() || ''
  if (!rule) return null
  if (!/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z0-9,=+\/-]+)*$/.test(rule)) return null
  return rule.slice(0, 200)
}

function localInstant(date: string, time: string) {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  const clockMatch = /^(\d{2}):(\d{2})/.exec(time)
  if (!day) throw new AppError(400, 'Use a date like 2026-11-03')
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clockMatch?.[1] || 9), Number(clockMatch?.[2] || 0), 0, 0)
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function clock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
