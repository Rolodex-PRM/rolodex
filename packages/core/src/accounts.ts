import { connect as netConnect, isIP, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import {
  calendarEvents,
  contactMethods,
  contacts,
  integrationCredentials,
  integrations,
  mailboxMessages,
  type Database,
} from '@rolodex/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { requireManager } from './access'
import { parseVevent } from './calendar'
import { AppError } from './errors'
import { parseFetchedHeaders, splitCalendarObjects } from './mail-parse'
import { normalizeEmail } from './normalize'
import { decryptSecret, encryptSecret } from './secrets'
import { credentialsKey } from './server-store'

type MailInput = { id?: string; name: string; host: string; port: number; secure: boolean; username: string; password?: string }
type CalendarInput = { id?: string; name: string; url: string; username: string; password?: string }

export async function listConnectedAccounts(db: Database, userId: string, workspaceId: string) {
  await requireManager(db, userId, workspaceId)
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId)))
    .orderBy(desc(integrations.createdAt))
  const accounts = rows.filter((row) => row.provider === 'mailbox' || row.provider === 'calendar')
  return Promise.all(accounts.map(async (row) => ({
    id: row.id,
    kind: row.provider,
    name: row.name,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    settings: publicSettings(row.provider, row.settings),
    messages: row.provider === 'mailbox' ? await recentMessages(db, row.id) : [],
  })))
}

export async function saveMailboxAccount(db: Database, userId: string, workspaceId: string, input: MailInput) {
  await requireManager(db, userId, workspaceId)
  assertDialHost(input.host)
  const settings = { host: input.host.trim(), port: input.port, secure: input.secure, username: input.username.trim() }
  return saveAccount(db, userId, workspaceId, input.id, 'mailbox', input.name, settings, input.password)
}

export async function saveCalendarAccount(db: Database, userId: string, workspaceId: string, input: CalendarInput) {
  await requireManager(db, userId, workspaceId)
  const url = accountUrl(input.url)
  const settings = { url: url.toString(), username: input.username.trim() }
  return saveAccount(db, userId, workspaceId, input.id, 'calendar', input.name, settings, input.password)
}

export async function deleteConnectedAccount(db: Database, userId: string, workspaceId: string, accountId: string) {
  await requireManager(db, userId, workspaceId)
  const row = await loadAccount(db, workspaceId, accountId)
  await db.delete(integrations).where(eq(integrations.id, row.id))
  return { ok: true }
}

export async function syncConnectedAccount(db: Database, userId: string, workspaceId: string, accountId: string) {
  await requireManager(db, userId, workspaceId)
  const row = await loadAccount(db, workspaceId, accountId)
  const password = await accountPassword(db, row.id)
  if (!password) throw new AppError(400, 'Enter the password for this account')
  try {
    if (row.provider === 'mailbox') {
      const settings = publicSettings('mailbox', row.settings) as { host: string; port: number; secure: boolean; username: string }
      const fetched = await fetchMailbox(settings, password)
      let stored = 0
      for (const message of fetched) {
        const contactId = await contactForEmail(db, workspaceId, message.email)
        await db
          .insert(mailboxMessages)
          .values({
            workspaceId,
            integrationId: row.id,
            contactId,
            externalId: message.uid,
            subject: message.subject,
            correspondent: message.email,
            occurredAt: message.occurredAt,
          })
          .onConflictDoUpdate({
            target: [mailboxMessages.integrationId, mailboxMessages.externalId],
            set: { subject: message.subject, correspondent: message.email, occurredAt: message.occurredAt, contactId },
          })
        stored += 1
      }
      await markSynced(db, row.id, 'connected')
      return { ok: true, imported: stored }
    }
    const settings = publicSettings('calendar', row.settings) as { url: string; username: string }
    const ics = await fetchCalendar(settings.url, settings.username, password)
    let imported = 0
    for (const block of splitCalendarObjects(ics)) {
      const uid = /^UID:(.+)$/im.exec(block)?.[1]?.trim()
      if (!uid) continue
      let parsed: ReturnType<typeof parseVevent>
      try {
        parsed = parseVevent(block)
      } catch {
        continue
      }
      const horizonStart = Date.now() - 90 * 24 * 60 * 60 * 1000
      const horizonEnd = Date.now() + 400 * 24 * 60 * 60 * 1000
      if (parsed.startAt.getTime() < horizonStart || parsed.startAt.getTime() > horizonEnd) continue
      const eventUid = `ext-${row.id}-${uid}`.slice(0, 180)
      await db
        .insert(calendarEvents)
        .values({
          workspaceId,
          ownerId: userId,
          uid: eventUid,
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
        })
        .onConflictDoUpdate({
          target: [calendarEvents.workspaceId, calendarEvents.uid],
          set: {
            summary: parsed.summary,
            description: parsed.description || null,
            location: parsed.location || null,
            startAt: parsed.startAt,
            endAt: parsed.endAt,
            allDay: parsed.allDay,
            updatedAt: new Date(),
            deletedAt: null,
          },
        })
      imported += 1
    }
    await markSynced(db, row.id, 'connected')
    return { ok: true, imported }
  } catch (error) {
    await markSynced(db, row.id, 'error')
    if (error instanceof AppError) throw error
    throw new AppError(502, error instanceof Error ? error.message : 'Could not reach that account')
  }
}

async function saveAccount(
  db: Database,
  userId: string,
  workspaceId: string,
  id: string | undefined,
  provider: string,
  name: string,
  settings: object,
  password?: string,
) {
  const existing = id ? await loadAccount(db, workspaceId, id) : null
  if (existing && existing.provider !== provider) throw new AppError(400, 'That account is a different kind')
  if (!existing && !password?.trim()) throw new AppError(400, 'Enter the password')
  const integrationId = existing
    ? existing.id
    : (await db.insert(integrations).values({ workspaceId, provider, name: name.trim(), status: 'disconnected', settings }).returning())[0]?.id
  if (!integrationId) throw new AppError(500, 'Could not save the account')
  if (existing) await db.update(integrations).set({ name: name.trim(), settings, updatedAt: new Date() }).where(eq(integrations.id, integrationId))
  if (password?.trim()) {
    const sealed = encryptSecret(password.trim(), credentialsKey())
    const [credential] = await db.select().from(integrationCredentials).where(eq(integrationCredentials.integrationId, integrationId)).limit(1)
    if (credential) await db.update(integrationCredentials).set({ ...sealed, updatedAt: new Date() }).where(eq(integrationCredentials.integrationId, integrationId))
    else await db.insert(integrationCredentials).values({ integrationId, ...sealed })
  }
  return listConnectedAccounts(db, userId, workspaceId)
}

async function loadAccount(db: Database, workspaceId: string, accountId: string) {
  const [row] = await db.select().from(integrations).where(and(eq(integrations.id, accountId), eq(integrations.workspaceId, workspaceId))).limit(1)
  if (!row || (row.provider !== 'mailbox' && row.provider !== 'calendar')) throw new AppError(404, 'Account not found')
  return row
}

async function accountPassword(db: Database, integrationId: string) {
  const [row] = await db.select().from(integrationCredentials).where(eq(integrationCredentials.integrationId, integrationId)).limit(1)
  if (!row) return ''
  return decryptSecret(row, credentialsKey())
}

async function markSynced(db: Database, id: string, status: string) {
  await db.update(integrations).set({ status, lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(integrations.id, id))
}

async function recentMessages(db: Database, integrationId: string) {
  const rows = await db
    .select({
      id: mailboxMessages.id,
      subject: mailboxMessages.subject,
      correspondent: mailboxMessages.correspondent,
      occurredAt: mailboxMessages.occurredAt,
      contactId: mailboxMessages.contactId,
    })
    .from(mailboxMessages)
    .where(eq(mailboxMessages.integrationId, integrationId))
    .orderBy(desc(mailboxMessages.occurredAt))
    .limit(15)
  return rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() }))
}

async function contactForEmail(db: Database, workspaceId: string, email: string) {
  const [row] = await db
    .select({ contactId: contactMethods.contactId })
    .from(contactMethods)
    .innerJoin(contacts, eq(contacts.id, contactMethods.contactId))
    .where(and(eq(contactMethods.kind, 'email'), eq(contactMethods.normalizedValue, normalizeEmail(email)), eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt)))
    .limit(1)
  return row?.contactId ?? null
}

function publicSettings(provider: string, value: unknown) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (provider === 'mailbox') {
    return {
      host: typeof row.host === 'string' ? row.host : '',
      port: typeof row.port === 'number' ? row.port : 993,
      secure: row.secure !== false,
      username: typeof row.username === 'string' ? row.username : '',
    }
  }
  return {
    url: typeof row.url === 'string' ? row.url : '',
    username: typeof row.username === 'string' ? row.username : '',
  }
}

function accountUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new AppError(400, 'Enter the calendar address')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new AppError(400, 'Enter an http or https calendar address')
  if (url.username || url.password) throw new AppError(400, 'Put the password in the password field')
  assertDialHost(url.hostname)
  return url
}

function assertDialHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  if (!host || host === 'metadata.google.internal') throw new AppError(400, 'That address is not allowed')
  if (isIP(host) && (host.startsWith('169.254.') || host === '0.0.0.0' || host === '::' || host.startsWith('fe80:'))) {
    throw new AppError(400, 'That address is not allowed')
  }
}

async function fetchMailbox(settings: { host: string; port: number; secure: boolean; username: string }, password: string) {
  assertDialHost(settings.host)
  const socket = settings.secure
    ? tlsConnect({ host: settings.host, port: settings.port, servername: settings.host })
    : netConnect({ host: settings.host, port: settings.port })
  const read = imapReader(socket)
  try {
    await read.waitGreeting()
    await read.command('a1', `LOGIN ${imapQuote(settings.username)} ${imapQuote(password)}`)
    await read.command('a2', 'SELECT INBOX')
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const stamp = `${since.getUTCDate()}-${months[since.getUTCMonth()]}-${since.getUTCFullYear()}`
    const search = await read.command('a3', `UID SEARCH SINCE ${stamp}`)
    const ids = (search.match(/\* SEARCH ([0-9 ]+)/i)?.[1] || '').trim().split(/\s+/).filter(Boolean)
    const latest = ids.slice(-25)
    if (!latest.length) return []
    const fetched = await read.command('a4', `UID FETCH ${latest.join(',')} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`)
    await read.command('a5', 'LOGOUT').catch(() => '')
    return parseFetchedHeaders(fetched)
  } finally {
    socket.destroy()
  }
}

function imapReader(socket: Socket) {
  let buffer = ''
  const pending: Array<() => void> = []
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    for (const wake of pending.splice(0)) wake()
  })
  const error = new Promise<never>((_resolve, reject) => {
    socket.once('error', () => reject(new AppError(502, 'Could not reach the mailbox')))
  })
  async function readUntil(pattern: RegExp) {
    const started = Date.now()
    while (Date.now() - started < 20_000) {
      const match = pattern.exec(buffer)
      if (match) return match
      await Promise.race([
        new Promise<void>((resolve) => pending.push(resolve)),
        error,
        new Promise((resolve) => setTimeout(resolve, 200)),
      ])
    }
    throw new AppError(502, 'The mailbox did not answer')
  }
  return {
    async waitGreeting() {
      await readUntil(/^\* (OK|PREAUTH)/im)
    },
    async command(tag: string, text: string) {
      socket.write(`${tag} ${text}\r\n`)
      const match = await readUntil(new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)[^\\r\\n]*`, 'i'))
      const end = (match.index ?? 0) + match[0].length
      const body = buffer.slice(0, end)
      buffer = buffer.slice(end)
      if (!/^OK$/i.test(match[1] || '')) throw new AppError(502, 'The mailbox refused the sign-in')
      return body
    },
  }
}

function imapQuote(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function fetchCalendar(url: string, username: string, password: string) {
  const target = accountUrl(url)
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  const report = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter>
</c:calendar-query>`
  let current = target
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, {
      method: 'REPORT',
      headers: { Authorization: authorization, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: report,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new AppError(502, 'Could not reach the calendar')
    })
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) throw new AppError(502, 'The calendar redirected without an address')
      current = accountUrl(new URL(next, current).toString())
      continue
    }
    if (response.status === 401) throw new AppError(401, 'The calendar did not accept that username and password')
    const text = await response.text()
    if (response.ok && /BEGIN:VEVENT/i.test(text)) return text
    const downloaded = await fetch(current, {
      headers: { Authorization: authorization },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
    if (downloaded.status === 401) throw new AppError(401, 'The calendar did not accept that username and password')
    const ics = await downloaded.text()
    if (!downloaded.ok || !/BEGIN:VEVENT/i.test(ics)) throw new AppError(502, 'That address did not return a calendar')
    return ics
  }
  throw new AppError(502, 'The calendar redirected too many times')
}
