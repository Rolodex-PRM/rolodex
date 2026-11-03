import { XMLParser } from 'fast-xml-parser'
import {
  AppError,
  authenticateAppPassword,
  canWriteContacts,
  createAddressBookForPrincipal,
  deleteCard,
  formatSyncToken,
  getLiveCard,
  listAddressBooks,
  listLiveCards,
  readSyncToken,
  syncCollection,
  updateAddressBook,
  upsertFromVCard,
  createRateLimiter,
} from '@rolodex/core'
import type { Database, WorkspaceRole } from '@rolodex/db'
import { handleCalendar } from './caldav'
import type { DavRequest, DavResult } from './dav-types'

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: '@_',
})

const failedAuth = createRateLimiter(30, 60_000)

export type { DavRequest, DavResult } from './dav-types'

const baseHeaders = {
  DAV: '1, 3, addressbook, calendar-access',
  Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT, MKCOL, PROPPATCH',
  'Cache-Control': 'no-store',
}

export async function handleDav(db: Database, request: DavRequest): Promise<DavResult> {
  const method = request.method.toUpperCase()
  if (method === 'OPTIONS') return text(200, '', baseHeaders)
  const credentials = basic(header(request.headers, 'authorization'))
  if (!credentials) return unauthorized()
  const user = await authenticateAppPassword(db, credentials.email, credentials.password)
  if (!user) {
    if (!failedAuth(request.ip || credentials.email)) return text(429, 'Too many attempts', { ...baseHeaders, 'WWW-Authenticate': 'Basic realm="Rolodex"' })
    return unauthorized()
  }
  const calendar = await handleCalendar(db, request, user.id)
  if (calendar) return calendar
  const route = matchPath(request.path)
  if (route.kind === 'unknown') return text(404, 'Not found', baseHeaders)
  if (route.kind !== 'root' && route.userId !== user.id) return text(403, 'Forbidden', baseHeaders)

  try {
    if (method === 'GET' && route.kind === 'root') {
      return redirect(`/principals/${user.id}/`)
    }
    if (method === 'PROPFIND' && (route.kind === 'root' || route.kind === 'principal')) {
      return route.kind === 'root' ? propfindRoot(user.id) : propfindPrincipal(user)
    }
    if (method === 'PROPFIND' && route.kind === 'home') return propfindHome(db, user.id, depth(request))
    if (method === 'PROPFIND' && route.kind === 'book') return propfindBook(db, user.id, route.segment, depth(request))
    if (method === 'PROPFIND' && route.kind === 'card') return propfindCard(db, user.id, route.segment, route.uid)
    if (method === 'REPORT' && route.kind === 'book') return report(db, user.id, route.segment, request.body)
    if ((method === 'GET' || method === 'HEAD') && route.kind === 'card') {
      return getCard(db, user.id, route.segment, route.uid, method === 'HEAD')
    }
    if (method === 'PUT' && route.kind === 'card') {
      return putCard(db, user.id, route.segment, route.uid, request.body, header(request.headers, 'if-match'))
    }
    if (method === 'DELETE' && route.kind === 'card') {
      await deleteCard(db, user.id, route.segment, route.uid)
      return text(204, '', baseHeaders)
    }
    if (method === 'MKCOL' && route.kind === 'book') return mkcol(db, user.id, route.segment, request.body)
    if (method === 'PROPPATCH' && route.kind === 'book') return proppatch(db, user.id, route.segment, request.body)
    return text(405, 'Method not allowed', baseHeaders)
  } catch (error) {
    const appError = error instanceof AppError ? error : error instanceof Error && error.cause instanceof AppError ? error.cause : null
    if (!appError) console.error(error)
    return text(appError?.status ?? 500, appError?.message ?? 'Internal server error', baseHeaders)
  }
}

async function propfindHome(db: Database, userId: string, deep: boolean) {
  const books = await listAddressBooks(db, userId)
  const self = ok(
    `/addressbooks/${userId}/`,
    `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>Address Books</d:displayname>`,
  )
  if (!deep) return multi(self)
  const children = books.map((book) => ok(bookHref(userId, book.urlSegment), bookProperties(book, book.role))).join('')
  return multi(self + children)
}

async function propfindBook(db: Database, userId: string, segment: string, deep: boolean) {
  const books = await listAddressBooks(db, userId)
  const book = books.find((item) => item.urlSegment === segment || item.id === segment)
  if (!book) return text(404, 'Address book not found', baseHeaders)
  const self = ok(bookHref(userId, book.urlSegment), bookProperties(book, book.role))
  if (!deep) return multi(self)
  const cards = await listLiveCards(db, userId, book.id)
  const children = cards
    .map((card) => ok(cardHref(userId, book.urlSegment, card.uid), cardProperties(card, false)))
    .join('')
  return multi(self + children)
}

async function propfindCard(db: Database, userId: string, segment: string, uid: string) {
  const card = await getLiveCard(db, userId, segment, uid)
  const book = (await listAddressBooks(db, userId)).find((item) => item.id === card.addressBookId)
  return multi(ok(cardHref(userId, book?.urlSegment || segment, uid), cardProperties(card, false)))
}

async function report(db: Database, userId: string, segment: string, body: string) {
  const books = await listAddressBooks(db, userId)
  const book = books.find((item) => item.urlSegment === segment || item.id === segment)
  if (!book) return text(404, 'Address book not found', baseHeaders)
  const doc = body.trim() ? parser.parse(body) : {}
  const root = Object.keys(doc).find((key) => !key.startsWith('?'))?.toLowerCase()
  if (root === 'sync-collection') {
    const raw = findText(doc, 'sync-token')
    const token = raw == null || raw.trim() === '' ? null : readSyncToken(raw)
    const result = await syncCollection(db, userId, book.id, token)
    const includeData = body.toLowerCase().includes('address-data')
    const responses = result.changes
      .map((change) => {
        const href = cardHref(userId, book.urlSegment, change.uid)
        if (change.deleted || !change.etag || !change.vcard) return missing(href)
        return ok(href, `<d:getetag>"${xmlEscape(change.etag)}"</d:getetag>${includeData ? `<card:address-data>${xmlEscape(change.vcard)}</card:address-data>` : ''}`)
      })
      .join('')
    return multi(responses, formatSyncToken(book.id, result.token))
  }
  let cards = await listLiveCards(db, userId, book.id)
  if (root === 'addressbook-multiget') {
    const hrefs = collect(doc, 'href')
    const uids = new Set(hrefs.map(uidFromHref).filter((uid): uid is string => Boolean(uid)))
    cards = cards.filter((card) => uids.has(card.uid))
  }
  const match = findText(doc, 'text-match')?.toLowerCase()
  if (match) cards = cards.filter((card) => card.vcardText.toLowerCase().includes(match))
  const includeData = body.toLowerCase().includes('address-data') || root === 'addressbook-query'
  const responses = cards.map((card) => ok(cardHref(userId, book.urlSegment, card.uid), cardProperties(card, includeData))).join('')
  return multi(responses)
}

async function getCard(db: Database, userId: string, segment: string, uid: string, head: boolean) {
  const card = await getLiveCard(db, userId, segment, uid)
  return {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Type': 'text/vcard; charset=utf-8',
      ETag: `"${card.etag}"`,
    },
    body: head ? '' : card.vcardText,
  }
}

async function putCard(db: Database, userId: string, segment: string, uid: string, body: string, ifMatch?: string) {
  try {
    const result = await upsertFromVCard(db, { userId, bookId: segment, uid, vcardText: body, ifMatch: ifMatch ?? null })
    return text(result.created ? 201 : 204, '', { ...baseHeaders, ETag: `"${result.etag}"` })
  } catch (error) {
    const appError = error instanceof AppError ? error : error instanceof Error && error.cause instanceof AppError ? error.cause : null
    if (!appError) console.error(error)
    return text(appError?.status ?? 500, appError?.message ?? 'Internal server error', baseHeaders)
  }
}

async function mkcol(db: Database, userId: string, segment: string, body: string) {
  const existing = (await listAddressBooks(db, userId)).find((book) => book.urlSegment === segment)
  if (existing) return text(405, 'Address book already exists', baseHeaders)
  const name = (body.trim() ? findText(parser.parse(body), 'displayname') : undefined) || 'Untitled'
  await createAddressBookForPrincipal(db, userId, name, segment)
  return text(201, '', baseHeaders)
}

async function proppatch(db: Database, userId: string, segment: string, body: string) {
  const name = findText(parser.parse(body), 'displayname')
  if (!name?.trim()) return text(400, 'displayname is required', baseHeaders)
  const updated = await updateAddressBook(db, userId, segment, { name: name.trim() })
  if (!updated) return text(404, 'Address book not found', baseHeaders)
  return multi(ok(bookHref(userId, updated.urlSegment), `<d:displayname>${xmlEscape(updated.name)}</d:displayname>`))
}

function propfindRoot(userId: string) {
  return multi(
    ok(
      '/',
      `<d:current-user-principal><d:href>/principals/${userId}/</d:href></d:current-user-principal><d:principal-URL><d:href>/principals/${userId}/</d:href></d:principal-URL><d:resourcetype><d:collection/></d:resourcetype>`,
    ),
  )
}

function propfindPrincipal(user: { id: string; displayName: string }) {
  return multi(
    ok(
      `/principals/${user.id}/`,
      `<d:displayname>${xmlEscape(user.displayName)}</d:displayname><d:resourcetype><d:collection/><d:principal/></d:resourcetype><card:addressbook-home-set><d:href>/addressbooks/${user.id}/</d:href></card:addressbook-home-set><cal:calendar-home-set><d:href>/calendars/${user.id}/</d:href></cal:calendar-home-set><d:current-user-principal><d:href>/principals/${user.id}/</d:href></d:current-user-principal>`,
    ),
  )
}

function bookProperties(book: { id: string; name: string; syncToken: number }, role: WorkspaceRole) {
  const write = canWriteContacts(role)
    ? '<d:privilege><d:write/></d:privilege><d:privilege><d:write-content/></d:privilege><d:privilege><d:bind/></d:privilege><d:privilege><d:unbind/></d:privilege>'
    : ''
  return `<d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>${xmlEscape(book.name)}</d:displayname><d:sync-token>${xmlEscape(formatSyncToken(book.id, book.syncToken))}</d:sync-token><cs:getctag>"${book.syncToken}"</cs:getctag><d:current-user-privilege-set><d:privilege><d:read/></d:privilege>${write}</d:current-user-privilege-set><card:supported-address-data><card:address-data-type content-type="text/vcard" version="3.0"/></card:supported-address-data><d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report><d:supported-report><d:report><card:addressbook-multiget/></d:report></d:supported-report><d:supported-report><d:report><card:addressbook-query/></d:report></d:supported-report></d:supported-report-set>`
}

function cardProperties(card: { etag: string; updatedAt: Date; vcardText: string }, includeData: boolean) {
  const data = includeData ? `<card:address-data>${xmlEscape(card.vcardText)}</card:address-data>` : ''
  return `<d:getetag>"${xmlEscape(card.etag)}"</d:getetag><d:getcontenttype>text/vcard; charset=utf-8</d:getcontenttype><d:getlastmodified>${card.updatedAt.toUTCString()}</d:getlastmodified><d:resourcetype/>${data}`
}

function matchPath(input: string) {
  const path = decodeURIComponent((input.split('?')[0] || '/')).replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/.well-known/carddav' || path === '/.well-known/caldav') return { kind: 'root' as const, userId: '' }
  const principal = path.match(/^\/principals\/([^/]+)$/)
  if (principal?.[1]) return { kind: 'principal' as const, userId: principal[1] }
  const home = path.match(/^\/addressbooks\/([^/]+)$/)
  if (home?.[1]) return { kind: 'home' as const, userId: home[1] }
  const card = path.match(/^\/addressbooks\/([^/]+)\/([^/]+)\/([^/]+)\.vcf$/)
  if (card?.[1] && card[2] && card[3]) return { kind: 'card' as const, userId: card[1], segment: card[2], uid: card[3] }
  const book = path.match(/^\/addressbooks\/([^/]+)\/([^/]+)$/)
  if (book?.[1] && book[2]) return { kind: 'book' as const, userId: book[1], segment: book[2] }
  return { kind: 'unknown' as const, userId: '' }
}

function uidFromHref(href: string) {
  const match = href.match(/([^/]+)\.vcf$/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function bookHref(userId: string, segment: string) {
  return `/addressbooks/${userId}/${segment}/`
}

function cardHref(userId: string, segment: string, uid: string) {
  return `/addressbooks/${userId}/${segment}/${encodeURIComponent(uid)}.vcf`
}

function multi(responses: string, syncToken?: string) {
  const token = syncToken ? `<d:sync-token>${xmlEscape(syncToken)}</d:sync-token>` : ''
  return {
    status: 207,
    headers: { ...baseHeaders, 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${responses}${token}</d:multistatus>`,
  }
}

function ok(href: string, inner: string) {
  return `<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${inner}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
}

function missing(href: string) {
  return `<d:response><d:href>${xmlEscape(href)}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
}

function text(status: number, body: string, headers: Record<string, string>): DavResult {
  return { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }, body }
}

function unauthorized(): DavResult {
  return text(401, 'Unauthorized', { ...baseHeaders, 'WWW-Authenticate': 'Basic realm="Rolodex"' })
}

function redirect(location: string): DavResult {
  return { status: 301, headers: { ...baseHeaders, Location: location }, body: '' }
}

function header(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function basic(value?: string) {
  if (!value?.toLowerCase().startsWith('basic ')) return null
  const decoded = Buffer.from(value.slice(6).trim(), 'base64').toString('utf8')
  const index = decoded.indexOf(':')
  if (index < 0) return null
  return { email: decoded.slice(0, index), password: decoded.slice(index + 1) }
}

function depth(request: DavRequest) {
  return (header(request.headers, 'depth') ?? 'infinity').toLowerCase() !== '0'
}

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function findText(node: unknown, target: string): string | undefined {
  const values = collect(node, target)
  return values[0]
}

function collect(node: unknown, target: string, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const item of node) collect(item, target, acc)
    return acc
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.toLowerCase() === target.toLowerCase()) {
      if (typeof value === 'string' || typeof value === 'number') acc.push(String(value))
      else if (value && typeof value === 'object' && '#text' in value) {
        const text = (value as { '#text'?: unknown })['#text']
        if (typeof text === 'string' || typeof text === 'number') acc.push(String(text))
      }
    }
    collect(value, target, acc)
  }
  return acc
}
