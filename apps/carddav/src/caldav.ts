import type { Database } from '@rolodex/db'
import {
  AppError,
  buildVevent,
  buildVtodo,
  calendarContext,
  deleteCalendarUid,
  deleteTodoUid,
  isDerivedUid,
  listCalendarFeed,
  listTodoFeed,
  upsertCalendarFromIcs,
  upsertTodoFromIcs,
} from '@rolodex/core'
import type { DavRequest, DavResult } from './dav-types'

const headers = {
  DAV: '1, 3, addressbook, calendar-access',
  Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT',
  'Cache-Control': 'no-store',
}

export async function handleCalendar(db: Database, request: DavRequest, userId: string): Promise<DavResult | null> {
  const route = matchCalendar(request.path)
  if (!route) return null
  if (route.userId !== userId) return text(403, 'Forbidden')
  const method = request.method.toUpperCase()
  try {
    if (method === 'PROPFIND' && route.kind === 'home') return propfindHome(db, userId, depth(request))
    if (method === 'PROPFIND' && route.kind === 'collection') return propfindCollection(db, userId, route.collection, depth(request))
    if (method === 'PROPFIND' && route.kind === 'event') return propfindEvent(db, userId, route.collection, route.uid)
    if (method === 'REPORT' && route.kind === 'collection') return report(db, userId, route.collection, request.body)
    if ((method === 'GET' || method === 'HEAD') && route.kind === 'event') return getEvent(db, userId, route.collection, route.uid, method === 'HEAD')
    if (method === 'PUT' && route.kind === 'event') {
      if (route.collection === 'tasks') {
        if (!/BEGIN:VTODO/i.test(request.body)) throw new AppError(400, 'This calendar stores tasks')
        const result = await upsertTodoFromIcs(db, userId, route.uid, request.body)
        return text(result.created ? 201 : 204, '', { ETag: `"${result.etag}"` })
      }
      if (/BEGIN:VTODO/i.test(request.body)) throw new AppError(400, 'This calendar stores events')
      const result = await upsertCalendarFromIcs(db, userId, route.uid, request.body, header(request.headers, 'if-match'))
      return text(result.created ? 201 : 204, '', { ETag: `"${result.etag}"` })
    }
    if (method === 'DELETE' && route.kind === 'event') {
      if (route.collection === 'tasks') await deleteTodoUid(db, userId, route.uid)
      else await deleteCalendarUid(db, userId, route.uid)
      return text(204, '')
    }
    return text(405, 'Method not allowed')
  } catch (error) {
    const appError = error instanceof AppError ? error : null
    if (!appError) console.error(error)
    return text(appError?.status ?? 500, appError?.message ?? 'Internal server error')
  }
}

async function propfindHome(db: Database, userId: string, deep: boolean) {
  const context = await calendarContext(db, userId)
  const self = ok(`/calendars/${userId}/`, '<d:resourcetype><d:collection/></d:resourcetype><d:displayname>Calendars</d:displayname>')
  if (!deep) return multi(self)
  const events = await listCalendarFeed(db, userId, context.workspaceId)
  const todos = await listTodoFeed(db, userId, context.workspaceId)
  return multi(
    self +
      ok(`/calendars/${userId}/rolodex/`, collectionProperties('Rolodex', 'VEVENT', 'Events from Rolodex', context.canWrite, events.token)) +
      ok(`/calendars/${userId}/tasks/`, collectionProperties('Tasks', 'VTODO', 'Tasks from Rolodex', context.canWrite, todos.token)),
  )
}

async function propfindCollection(db: Database, userId: string, collection: 'rolodex' | 'tasks', deep: boolean) {
  const context = await calendarContext(db, userId)
  if (collection === 'tasks') {
    const feed = await listTodoFeed(db, userId, context.workspaceId)
    const self = ok(`/calendars/${userId}/tasks/`, collectionProperties('Tasks', 'VTODO', 'Tasks from Rolodex', context.canWrite, feed.token))
    if (!deep) return multi(self)
    const children = feed.items.map((item) => ok(itemHref(userId, 'tasks', item.uid), todoProperties(item))).join('')
    return multi(self + children)
  }
  const feed = await listCalendarFeed(db, userId, context.workspaceId)
  const self = ok(`/calendars/${userId}/rolodex/`, collectionProperties('Rolodex', 'VEVENT', 'Events from Rolodex', context.canWrite, feed.token))
  if (!deep) return multi(self)
  const children = feed.items.map((item) => ok(itemHref(userId, 'rolodex', item.uid), eventProperties(item))).join('')
  return multi(self + children)
}

async function propfindEvent(db: Database, userId: string, collection: 'rolodex' | 'tasks', uid: string) {
  if (collection === 'tasks') {
    const item = await oneTodo(db, userId, uid)
    return multi(ok(itemHref(userId, 'tasks', uid), todoProperties(item)))
  }
  const item = await oneEvent(db, userId, uid)
  return multi(ok(itemHref(userId, 'rolodex', uid), eventProperties(item)))
}

async function getEvent(db: Database, userId: string, collection: 'rolodex' | 'tasks', uid: string, head: boolean) {
  if (collection === 'tasks') {
    const item = await oneTodo(db, userId, uid)
    return {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', ETag: `"${item.etag}"` },
      body: head ? '' : buildVtodo(item),
    }
  }
  const item = await oneEvent(db, userId, uid)
  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'text/calendar; charset=utf-8', ETag: `"${item.etag}"` },
    body: head ? '' : buildVevent(item),
  }
}

async function report(db: Database, userId: string, collection: 'rolodex' | 'tasks', body: string) {
  const context = await calendarContext(db, userId)
  if (collection === 'tasks') {
    const feed = await listTodoFeed(db, userId, context.workspaceId)
    return reportItems(userId, 'tasks', body, feed.token, context.workspaceId, feed.items, feed.stored, (item) => todoProperties(item, body.toLowerCase().includes('calendar-data')))
  }
  const feed = await listCalendarFeed(db, userId, context.workspaceId)
  return reportItems(userId, 'rolodex', body, feed.token, context.workspaceId, feed.items, feed.stored, (item) => eventProperties(item, body.toLowerCase().includes('calendar-data')))
}

function reportItems<T extends { uid: string; updatedAt: Date }>(
  userId: string,
  collection: 'rolodex' | 'tasks',
  body: string,
  token: number,
  workspaceId: string,
  items: T[],
  stored: { uid: string; deletedAt: Date | null; updatedAt: Date }[],
  properties: (item: T) => string,
) {
  const root = body.toLowerCase()
  let rows = items
  if (root.includes('calendar-multiget') || root.includes('href')) {
    const uids = new Set([...body.matchAll(/\/([^/<>"]+)\.ics/gi)].map((match) => decodeURIComponent(match[1] || '')))
    if (uids.size) rows = rows.filter((item) => uids.has(item.uid))
  }
  const since = Number(body.match(/(\d{10,})/)?.[1] || '')
  if (root.includes('sync-collection') && Number.isFinite(since) && since > 0) {
    rows = rows.filter((item) => item.updatedAt.getTime() > since)
  }
  const responses = rows.map((item) => ok(itemHref(userId, collection, item.uid), properties(item))).join('')
  const removed = root.includes('sync-collection')
    ? stored
        .filter((row) => row.deletedAt && (!since || row.updatedAt.getTime() > since) && !isDerivedUid(row.uid))
        .map((row) => missing(itemHref(userId, collection, row.uid)))
        .join('')
    : ''
  return multi(responses + removed, `https://rolodex.local/calendars/${workspaceId}/${collection}/${token}`)
}

async function oneEvent(db: Database, userId: string, uid: string) {
  const context = await calendarContext(db, userId)
  const feed = await listCalendarFeed(db, userId, context.workspaceId)
  const item = feed.items.find((entry) => entry.uid === uid)
  if (!item) throw new AppError(404, 'Event not found')
  return item
}

async function oneTodo(db: Database, userId: string, uid: string) {
  const context = await calendarContext(db, userId)
  const feed = await listTodoFeed(db, userId, context.workspaceId)
  const item = feed.items.find((entry) => entry.uid === uid)
  if (!item) throw new AppError(404, 'Task not found')
  return item
}

function collectionProperties(name: string, component: 'VEVENT' | 'VTODO', description: string, canWrite: boolean, token: number) {
  const write = canWrite ? '<d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>' : ''
  return `<d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>${xmlEscape(name)}</d:displayname><d:sync-token>https://rolodex.local/sync/${token}</d:sync-token><cal:supported-calendar-component-set><cal:comp name="${component}"/></cal:supported-calendar-component-set><cal:calendar-description>${xmlEscape(description)}</cal:calendar-description><d:current-user-privilege-set><d:privilege><d:read/></d:privilege>${write}</d:current-user-privilege-set><d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report><d:supported-report><d:report><cal:calendar-query/></d:report></d:supported-report><d:supported-report><d:report><cal:calendar-multiget/></d:report></d:supported-report></d:supported-report-set>`
}

function todoProperties(item: { etag: string; updatedAt: Date; uid: string; summary: string; notes: string; due: string | null; priority: number; rrule: string | null; completed: boolean }, includeData = false) {
  const data = includeData ? `<cal:calendar-data>${xmlEscape(buildVtodo(item))}</cal:calendar-data>` : ''
  return `<d:getetag>"${xmlEscape(item.etag)}"</d:getetag><d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype><d:getlastmodified>${item.updatedAt.toUTCString()}</d:getlastmodified><d:resourcetype/>${data}`
}

function eventProperties(item: { etag: string; updatedAt: Date; uid: string; type: string; summary: string; description: string; start: string; end: string; allDay: boolean }, includeData = false) {
  const data = includeData ? `<cal:calendar-data>${xmlEscape(buildVevent(item))}</cal:calendar-data>` : ''
  return `<d:getetag>"${xmlEscape(item.etag)}"</d:getetag><d:getcontenttype>text/calendar; charset=utf-8</d:getcontenttype><d:getlastmodified>${item.updatedAt.toUTCString()}</d:getlastmodified><d:resourcetype/>${data}`
}

function matchCalendar(input: string) {
  const path = decodeURIComponent((input.split('?')[0] || '/')).replace(/\/+$/, '') || '/'
  const event = path.match(/^\/calendars\/([^/]+)\/(rolodex|tasks)\/([^/]+)\.ics$/)
  const eventCollection = asCollection(event?.[2])
  if (event?.[1] && event[3] && eventCollection) {
    return { kind: 'event' as const, userId: event[1], collection: eventCollection, uid: event[3] }
  }
  const collection = path.match(/^\/calendars\/([^/]+)\/(rolodex|tasks)$/)
  const book = asCollection(collection?.[2])
  if (collection?.[1] && book) {
    return { kind: 'collection' as const, userId: collection[1], collection: book }
  }
  const home = path.match(/^\/calendars\/([^/]+)$/)
  if (home?.[1]) return { kind: 'home' as const, userId: home[1], collection: 'rolodex' as const }
  return null
}

function asCollection(value: string | undefined): 'rolodex' | 'tasks' | null {
  if (value === 'rolodex' || value === 'tasks') return value
  return null
}

function itemHref(userId: string, collection: 'rolodex' | 'tasks', uid: string) {
  return `/calendars/${userId}/${collection}/${encodeURIComponent(uid)}.ics`
}

function multi(responses: string, syncToken?: string) {
  const token = syncToken ? `<d:sync-token>${xmlEscape(syncToken)}</d:sync-token>` : ''
  return {
    status: 207,
    headers: { ...headers, 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${responses}${token}</d:multistatus>`,
  }
}

function ok(href: string, inner: string) {
  return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${inner}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
}

function missing(href: string) {
  return `<d:response><d:href>${xmlEscape(href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
}

function text(status: number, body: string, extra: Record<string, string> = {}): DavResult {
  return { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', ...extra }, body }
}

function header(headers: DavRequest['headers'], name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function depth(request: DavRequest) {
  return (header(request.headers, 'depth') ?? 'infinity').toLowerCase() !== '0'
}

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
