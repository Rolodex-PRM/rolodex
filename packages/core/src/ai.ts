import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { aiSuggestions, contacts, integrationCredentials, integrations, type Database } from '@rolodex/db'
import { and, eq } from 'drizzle-orm'
import { requireManager, requireMembership, requireWriter } from './access'
import { addonEnabled } from './addons'
import { AppError } from './errors'
import { getContact, requireContactWrite, writeAudit } from './contacts'
import { decryptSecret, encryptSecret } from './secrets'
import { createRateLimiter } from './rate-limit'

export const suggestionFields = ['organizationName', 'title', 'department', 'website', 'interests'] as const
export type SuggestionField = (typeof suggestionFields)[number]

const fieldLabels: Record<SuggestionField, string> = {
  organizationName: 'organization',
  title: 'title',
  department: 'department',
  website: 'website',
  interests: 'interests',
}

const lookups = createRateLimiter(8, 60_000)

export function isSuggestionField(value: string): value is SuggestionField {
  return (suggestionFields as readonly string[]).includes(value)
}

export function publicHttpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null
  if (!isPublicHost(url.hostname)) return null
  return url
}

export function pageContains(pageText: string, value: string) {
  const needle = value.replace(/\s+/g, ' ').trim()
  const haystack = pageText.replace(/\s+/g, ' ')
  if (needle.length < 2 || needle.length > 200) return null
  const at = haystack.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return null
  const excerpt = haystack.slice(Math.max(0, at - 80), at + needle.length + 80).trim()
  return { excerpt }
}

export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function getAiSettings(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const enabled = await addonEnabled(db, workspaceId, 'ai')
  const row = await loadIntegration(db, workspaceId)
  const settings = settingsOf(row?.integration.settings)
  let manager = false
  try {
    await requireManager(db, userId, workspaceId)
    manager = true
  } catch {
    manager = false
  }
  return {
    enabled,
    baseUrl: manager ? settings.baseUrl : '',
    model: manager ? settings.model : '',
    hasKey: Boolean(row?.credential),
  }
}

export async function setAiSettings(
  db: Database,
  userId: string,
  workspaceId: string,
  input: { baseUrl: string; model: string; apiKey?: string },
) {
  await requireManager(db, userId, workspaceId)
  if (!(await addonEnabled(db, workspaceId, 'ai'))) throw new AppError(403, 'Enable the AI add-on first')
  const baseUrl = normalizeBase(input.baseUrl)
  const model = input.model.trim()
  if (!model) throw new AppError(400, 'Choose a model')
  const row = await loadIntegration(db, workspaceId)
  const settings = { baseUrl, model }
  const integrationId = row
    ? row.integration.id
    : (await db.insert(integrations).values({ workspaceId, provider: 'ai', name: 'assistant', status: 'connected', settings }).returning())[0]?.id
  if (!integrationId) throw new AppError(500, 'Could not save the AI settings')
  if (row) await db.update(integrations).set({ settings, status: 'connected', updatedAt: new Date() }).where(eq(integrations.id, integrationId))
  const apiKey = input.apiKey?.trim()
  if (apiKey) {
    const sealed = encryptSecret(apiKey, credentialsKey())
    if (row?.credential) await db.update(integrationCredentials).set({ ...sealed, updatedAt: new Date() }).where(eq(integrationCredentials.integrationId, integrationId))
    else await db.insert(integrationCredentials).values({ integrationId, ...sealed })
  } else if (!row?.credential) throw new AppError(400, 'Add an API key')
  return getAiSettings(db, userId, workspaceId)
}

export async function testAiConnection(db: Database, userId: string, workspaceId: string) {
  await requireManager(db, userId, workspaceId)
  const config = await requireConfig(db, workspaceId)
  const body = await complete(config, 'Reply with JSON {"ok":true} and nothing else.')
  if (!body.includes('ok')) throw new AppError(502, 'The AI service did not answer')
  return { ok: true }
}

export async function listSuggestions(db: Database, userId: string, workspaceId: string, contactId?: string, status = 'pending') {
  await requireMembership(db, userId, workspaceId)
  const filters = [eq(aiSuggestions.workspaceId, workspaceId), eq(aiSuggestions.status, status)]
  if (contactId) filters.push(eq(aiSuggestions.contactId, contactId))
  const rows = await db
    .select({
      id: aiSuggestions.id,
      contactId: aiSuggestions.contactId,
      displayName: contacts.displayName,
      field: aiSuggestions.field,
      value: aiSuggestions.value,
      sourceUrl: aiSuggestions.sourceUrl,
      excerpt: aiSuggestions.excerpt,
      status: aiSuggestions.status,
      createdAt: aiSuggestions.createdAt,
    })
    .from(aiSuggestions)
    .innerJoin(contacts, eq(contacts.id, aiSuggestions.contactId))
    .where(and(...filters))
    .limit(40)
  return rows.map((row) => ({ ...row, label: isSuggestionField(row.field) ? fieldLabels[row.field] : row.field, createdAt: row.createdAt.toISOString() }))
}

export async function suggestContactFields(db: Database, userId: string, workspaceId: string, contactId: string) {
  await requireWriter(db, userId, workspaceId)
  if (!lookups(userId)) throw new AppError(429, 'Wait a moment before asking again')
  const config = await requireConfig(db, workspaceId)
  const contact = await getContact(db, userId, workspaceId, contactId)
  const known = [
    contact.displayName,
    contact.title,
    contact.department,
    contact.organizationName,
    contact.website,
    contact.interests,
    contact.addresses.map((address) => [address.city, address.region, address.country].filter(Boolean).join(', ')).filter(Boolean).join('; '),
  ].filter(Boolean).join('\n')
  const raw = await complete(config, [
    'Suggest contact fields only when a public web page states the value.',
    'Return JSON {"suggestions":[{"field":"organizationName|title|department|website|interests","value":"exact text from the page","sourceUrl":"https://..."}]}',
    'If a page does not state it, leave it out. Do not guess. Do not suggest email, phone, birthday, or street address.',
    `Known facts:\n${known}`,
  ].join('\n'))
  const parsed = parseSuggestions(raw)
  let kept = 0
  let discarded = 0
  for (const item of parsed) {
    const verified = await verifySuggestion(item)
    if (!verified || currentValue(contact, item.field) === item.value) {
      discarded += 1
      await writeAudit(db, workspaceId, userId, 'contact.ai_discard', contactId, 'contact', {
        outcome: 'unverified',
        field: item.field,
        sourceUrl: item.sourceUrl,
        value: item.value,
      })
      continue
    }
    await db.insert(aiSuggestions).values({
      workspaceId,
      contactId,
      field: item.field,
      value: item.value,
      sourceUrl: verified.url,
      excerpt: verified.excerpt,
      createdBy: userId,
    })
    kept += 1
    await writeAudit(db, workspaceId, userId, 'contact.ai_suggest', contactId, 'contact', {
      outcome: 'waiting for review',
      field: fieldLabels[item.field],
      sourceUrl: verified.url,
    })
  }
  if (!parsed.length) await writeAudit(db, workspaceId, userId, 'contact.ai_suggest', contactId, 'contact', { outcome: 'nothing found' })
  return { kept, discarded, suggestions: await listSuggestions(db, userId, workspaceId, contactId, 'pending') }
}

export async function approveSuggestion(db: Database, userId: string, workspaceId: string, suggestionId: string) {
  const row = await pendingSuggestion(db, userId, workspaceId, suggestionId)
  if (!isSuggestionField(row.field)) throw new AppError(400, 'That field cannot be filled automatically')
  const updatedAt = new Date()
  const value = row.value
  if (row.field === 'organizationName') await db.update(contacts).set({ organizationName: value, updatedAt }).where(eq(contacts.id, row.contactId))
  if (row.field === 'title') await db.update(contacts).set({ title: value, updatedAt }).where(eq(contacts.id, row.contactId))
  if (row.field === 'department') await db.update(contacts).set({ department: value, updatedAt }).where(eq(contacts.id, row.contactId))
  if (row.field === 'website') await db.update(contacts).set({ website: value, updatedAt }).where(eq(contacts.id, row.contactId))
  if (row.field === 'interests') await db.update(contacts).set({ interests: value, updatedAt }).where(eq(contacts.id, row.contactId))
  await db.update(aiSuggestions).set({ status: 'approved', reviewedBy: userId, reviewedAt: new Date() }).where(eq(aiSuggestions.id, row.id))
  await writeAudit(db, workspaceId, userId, 'contact.ai_approve', row.contactId, 'contact', {
    outcome: 'approved',
    field: fieldLabels[row.field],
    sourceUrl: row.sourceUrl,
  })
  return { ok: true }
}

export async function rejectSuggestion(db: Database, userId: string, workspaceId: string, suggestionId: string) {
  const row = await pendingSuggestion(db, userId, workspaceId, suggestionId)
  await db.update(aiSuggestions).set({ status: 'rejected', reviewedBy: userId, reviewedAt: new Date() }).where(eq(aiSuggestions.id, row.id))
  await writeAudit(db, workspaceId, userId, 'contact.ai_reject', row.contactId, 'contact', {
    outcome: 'dismissed',
    field: isSuggestionField(row.field) ? fieldLabels[row.field] : row.field,
    sourceUrl: row.sourceUrl,
  })
  return { ok: true }
}

async function verifySuggestion(item: { field: SuggestionField; value: string; sourceUrl: string }) {
  if (item.field === 'interests' && item.value.trim().length < 8) return null
  const url = publicHttpUrl(item.sourceUrl)
  if (!url) return null
  if (item.field === 'website') {
    const site = publicHttpUrl(item.value)
    if (!site) return null
  }
  try {
    const page = await readPublicPage(url)
    const found = pageContains(page, item.field === 'website' ? new URL(item.value).hostname.replace(/^www\./, '') : item.value)
    if (!found) return null
    return { url: url.toString(), excerpt: found.excerpt }
  } catch {
    return null
  }
}

async function readPublicPage(start: URL) {
  let current = start
  for (let hop = 0; hop < 3; hop += 1) {
    await assertResolvedPublic(current.hostname)
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html,text/plain' } })
    if (response.status >= 300 && response.status < 400) {
      const next = publicHttpUrl(new URL(response.headers.get('location') || '', current).toString())
      if (!next) throw new AppError(400, 'The source redirected to a private address')
      current = next
      continue
    }
    if (!response.ok) throw new AppError(400, 'The source page did not load')
    const type = response.headers.get('content-type') || ''
    if (!type.includes('text/html') && !type.includes('text/plain')) throw new AppError(400, 'The source is not a web page')
    const text = await response.text()
    return htmlToText(text.slice(0, 500_000))
  }
  throw new AppError(400, 'The source redirected too many times')
}

function parseSuggestions(raw: string) {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let body: { suggestions?: { field?: string; value?: string; sourceUrl?: string }[] }
  try {
    body = JSON.parse(json) as typeof body
  } catch {
    throw new AppError(502, 'The AI did not return reviewable suggestions')
  }
  const items = []
  for (const item of body.suggestions ?? []) {
    const field = item.field?.trim() || ''
    const value = item.value?.replace(/\s+/g, ' ').trim() || ''
    const sourceUrl = item.sourceUrl?.trim() || ''
    if (!isSuggestionField(field) || !value || !sourceUrl) continue
    items.push({ field, value: value.slice(0, 200), sourceUrl })
  }
  return items.slice(0, 5)
}

function currentValue(contact: Awaited<ReturnType<typeof getContact>>, field: SuggestionField) {
  return (contact[field] || '').trim()
}

async function pendingSuggestion(db: Database, userId: string, workspaceId: string, suggestionId: string) {
  const [row] = await db.select().from(aiSuggestions).where(and(eq(aiSuggestions.id, suggestionId), eq(aiSuggestions.workspaceId, workspaceId), eq(aiSuggestions.status, 'pending'))).limit(1)
  if (!row) throw new AppError(404, 'Suggestion not found')
  await requireContactWrite(db, userId, workspaceId, row.contactId)
  return row
}

async function requireConfig(db: Database, workspaceId: string) {
  if (!(await addonEnabled(db, workspaceId, 'ai'))) throw new AppError(403, 'Enable the AI add-on in Admin')
  const row = await loadIntegration(db, workspaceId)
  const settings = settingsOf(row?.integration.settings)
  if (!row?.credential || !settings.baseUrl || !settings.model) throw new AppError(400, 'Save the AI server, model, and API key')
  return { ...settings, apiKey: decryptSecret(row.credential, credentialsKey()) }
}

async function complete(config: { baseUrl: string; model: string; apiKey: string }, prompt: string) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) throw new AppError(502, 'The AI service rejected the request')
  const body = await response.json() as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content || ''
}

async function loadIntegration(db: Database, workspaceId: string) {
  const [row] = await db
    .select({ integration: integrations, credential: integrationCredentials })
    .from(integrations)
    .leftJoin(integrationCredentials, eq(integrationCredentials.integrationId, integrations.id))
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'ai')))
    .limit(1)
  return row
}

function settingsOf(value: unknown) {
  const row = value && typeof value === 'object' ? value as { baseUrl?: unknown; model?: unknown } : {}
  return {
    baseUrl: typeof row.baseUrl === 'string' ? row.baseUrl : '',
    model: typeof row.model === 'string' ? row.model : '',
  }
}

function normalizeBase(value: string) {
  const url = publicHttpUrl(value.trim())
  if (!url) throw new AppError(400, 'Use an https address for the AI server')
  return url.toString().replace(/\/$/, '').replace(/\/chat\/completions$/, '')
}

function credentialsKey() {
  const key = process.env.CREDENTIALS_KEY
  if (!key) throw new AppError(500, 'CREDENTIALS_KEY is not configured')
  return key
}

function isPublicHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return false
  if (isIP(host)) return isPublicIp(host)
  return true
}

function isPublicIp(value: string) {
  if (value.includes(':')) {
    const host = value.toLowerCase()
    return host !== '::1' && !host.startsWith('fc') && !host.startsWith('fd') && !host.startsWith('fe80')
  }
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  return true
}

async function assertResolvedPublic(hostname: string) {
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new AppError(400, 'That source address is private')
    return
  }
  const records = await lookup(hostname, { all: true })
  if (!records.length || records.some((record) => !isPublicIp(record.address))) throw new AppError(400, 'That source address is private')
}
