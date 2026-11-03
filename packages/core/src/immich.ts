import {
  activities,
  activityAssets,
  activityContacts,
  contactExternalIdentities,
  contacts,
  immichAssets,
  immichInstances,
  immichPeople,
  integrationCredentials,
  integrations,
  syncJobs,
  type Database,
} from '@rolodex/db'
import { and, asc, eq, ilike, isNull } from 'drizzle-orm'
import { addonEnabled } from './addons'
import { requireManager, requireMembership, requireWriter } from './access'
import { getContact } from './contacts'
import { AppError } from './errors'
import { decryptSecret, encryptSecret } from './secrets'

export const savedSecret = '*********'

type RemotePerson = { id: string; name: string; thumbnailPath: string; isHidden: boolean }
type RemoteAsset = { id: string; type: string; takenAt: string | null }

async function assertImmich(db: Database, workspaceId: string) {
  if (!(await addonEnabled(db, workspaceId, 'immich'))) throw new AppError(403, 'Enable the Immich add-on in Admin')
}

function credentialsKey() {
  const key = process.env.CREDENTIALS_KEY
  if (!key) throw new AppError(500, 'CREDENTIALS_KEY is not configured')
  return key
}

export function immichBaseUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new AppError(400, 'Enter a full Immich URL, including http:// or https://')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError(400, 'Use an http or https Immich URL')
  if (url.username || url.password) throw new AppError(400, 'Put the API key in its own field')
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function immichNameScore(personName: string, names: Array<string | null | undefined>) {
  const person = normalizeName(personName)
  if (person.length < 3) return 0
  const targets = names.map((name) => (name ? normalizeName(name) : '')).filter((name) => name.length >= 3)
  if (targets.some((name) => name === person)) return 100
  const tokens = person.split(' ').filter((token) => token.length > 1)
  if (tokens.length < 2) return 0
  if (targets.some((name) => tokens.every((token) => name.split(' ').includes(token)))) return 80
  return 0
}

export function parseImmichPeople(body: unknown): { people: RemotePerson[]; hasNextPage: boolean } {
  const rows = Array.isArray(body) ? body : body && typeof body === 'object' && Array.isArray((body as { people?: unknown }).people) ? (body as { people: unknown[] }).people : []
  const hasNextPage = Boolean(body && typeof body === 'object' && (body as { hasNextPage?: boolean }).hasNextPage)
  const people = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const record = row as { id?: unknown; name?: unknown; thumbnailPath?: unknown; isHidden?: unknown }
    if (typeof record.id !== 'string') return []
    return [{
      id: record.id,
      name: typeof record.name === 'string' ? record.name : '',
      thumbnailPath: typeof record.thumbnailPath === 'string' ? record.thumbnailPath : '',
      isHidden: Boolean(record.isHidden),
    }]
  })
  return { people, hasNextPage }
}

export function parseImmichAssets(body: unknown): { items: RemoteAsset[]; total: number } {
  const assets = body && typeof body === 'object' ? (body as { assets?: unknown }).assets : undefined
  const rows = Array.isArray(assets) ? assets : assets && typeof assets === 'object' && Array.isArray((assets as { items?: unknown }).items) ? (assets as { items: unknown[] }).items : []
  const total = assets && typeof assets === 'object' && typeof (assets as { total?: unknown }).total === 'number' ? (assets as { total: number }).total : rows.length
  const items = rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const record = row as { id?: unknown; type?: unknown; fileCreatedAt?: unknown; localDateTime?: unknown }
    if (typeof record.id !== 'string') return []
    const taken = typeof record.fileCreatedAt === 'string' ? record.fileCreatedAt : typeof record.localDateTime === 'string' ? record.localDateTime : null
    return [{ id: record.id, type: typeof record.type === 'string' ? record.type : 'IMAGE', takenAt: taken }]
  })
  return { items, total }
}

async function immichRequest(base: string, apiKey: string, path: string, init: RequestInit = {}) {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'x-api-key': apiKey, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new AppError(502, 'Immich could not be reached')
  }
  if (response.status === 401 || response.status === 403) throw new AppError(400, 'Immich rejected the API key')
  if (!response.ok) throw new AppError(502, 'Immich could not complete that request')
  return response
}

async function immichJson(base: string, apiKey: string, path: string, init?: RequestInit) {
  const response = await immichRequest(base, apiKey, path, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  return response.json() as Promise<unknown>
}

export async function probeImmich(internalUrl: string, apiKey: string) {
  const base = immichBaseUrl(internalUrl)
  if (!apiKey.trim() || apiKey.trim() === savedSecret) throw new AppError(400, 'Enter an Immich API key')
  const about = await immichJson(base, apiKey.trim(), '/api/server/about')
  const me = await immichJson(base, apiKey.trim(), '/api/users/me')
  const version = about && typeof about === 'object' && typeof (about as { version?: unknown }).version === 'string' ? (about as { version: string }).version : ''
  const user = me && typeof me === 'object' && typeof (me as { name?: unknown }).name === 'string' ? (me as { name: string }).name : ''
  return { version, user }
}

async function fetchAllPeople(base: string, apiKey: string) {
  const people: RemotePerson[] = []
  for (let page = 1; page <= 40; page += 1) {
    const body = await immichJson(base, apiKey, `/api/people?page=${page}&size=500&withHidden=false`)
    const parsed = parseImmichPeople(body)
    people.push(...parsed.people)
    if (!parsed.hasNextPage || parsed.people.length === 0) break
  }
  return people
}

async function searchAssets(base: string, apiKey: string, personId: string, type?: 'IMAGE' | 'VIDEO', size = 12) {
  const body = await immichJson(base, apiKey, '/api/search/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personIds: [personId], size, page: 1, ...(type ? { type } : {}) }),
  })
  return parseImmichAssets(body)
}

function isMissing(raw: unknown) {
  return Boolean(raw && typeof raw === 'object' && (raw as { missing?: boolean }).missing)
}

async function loadKey(db: Database, instanceId: string, workspaceId: string) {
  const [row] = await db
    .select({
      instance: immichInstances,
      ciphertext: integrationCredentials.ciphertext,
      nonce: integrationCredentials.nonce,
    })
    .from(immichInstances)
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .innerJoin(integrationCredentials, eq(integrationCredentials.integrationId, integrations.id))
    .where(and(eq(immichInstances.id, instanceId), eq(integrations.workspaceId, workspaceId)))
    .limit(1)
  if (!row) throw new AppError(404, 'Immich connection not found')
  return { instance: row.instance, apiKey: decryptSecret({ ciphertext: row.ciphertext, nonce: row.nonce }, credentialsKey()) }
}

function presentInstance(row: typeof immichInstances.$inferSelect, settings: unknown) {
  const error = settings && typeof settings === 'object' && typeof (settings as { lastError?: unknown }).lastError === 'string' ? (settings as { lastError: string }).lastError : null
  return {
    id: row.id,
    name: row.name,
    internalUrl: row.internalUrl,
    externalUrl: row.externalUrl,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    apiKey: savedSecret,
    error,
  }
}

export async function listImmichInstances(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const rows = await db
    .select({ instance: immichInstances, settings: integrations.settings })
    .from(immichInstances)
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(eq(integrations.workspaceId, workspaceId))
    .orderBy(asc(immichInstances.name))
  return rows.map((row) => presentInstance(row.instance, row.settings))
}

export async function saveImmichInstance(
  db: Database,
  userId: string,
  workspaceId: string,
  input: { id?: string; name: string; internalUrl: string; externalUrl?: string; apiKey?: string },
) {
  await requireManager(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const name = input.name.trim()
  const internalUrl = immichBaseUrl(input.internalUrl)
  const externalUrl = input.externalUrl?.trim() ? immichBaseUrl(input.externalUrl) : internalUrl
  if (input.id) {
    const existing = await loadKey(db, input.id, workspaceId)
    const typed = input.apiKey?.trim() ?? ''
    const apiKey = typed === savedSecret ? existing.apiKey : typed
    if (!apiKey) throw new AppError(400, 'Enter an Immich API key')
    let status = 'connected'
    let error: string | null = null
    try {
      await probeImmich(internalUrl, apiKey)
    } catch (caught) {
      status = 'error'
      error = caught instanceof Error ? caught.message : 'Immich could not be reached'
    }
    await db.update(integrationCredentials).set({ ...encryptSecret(apiKey, credentialsKey()), updatedAt: new Date() }).where(eq(integrationCredentials.integrationId, existing.instance.integrationId))
    await db.update(integrations).set({ name, status, settings: { lastError: error }, updatedAt: new Date() }).where(eq(integrations.id, existing.instance.integrationId))
    const [instance] = await db.update(immichInstances).set({ name, internalUrl, externalUrl, status }).where(eq(immichInstances.id, existing.instance.id)).returning()
    return presentInstance(instance!, { lastError: error })
  }
  const apiKey = input.apiKey?.trim() ?? ''
  let status = 'connected'
  let error: string | null = null
  try {
    await probeImmich(internalUrl, apiKey)
  } catch (caught) {
    status = 'error'
    error = caught instanceof Error ? caught.message : 'Immich could not be reached'
    if (!apiKey || apiKey === savedSecret) throw caught instanceof AppError ? caught : new AppError(400, error)
  }
  const [integration] = await db.insert(integrations).values({ workspaceId, provider: 'immich', name, status, settings: { lastError: error } }).returning()
  await db.insert(integrationCredentials).values({ integrationId: integration!.id, ...encryptSecret(apiKey, credentialsKey()) })
  const [instance] = await db.insert(immichInstances).values({ integrationId: integration!.id, name, internalUrl, externalUrl, status }).returning()
  return presentInstance(instance!, { lastError: error })
}

export async function deleteImmichInstance(db: Database, userId: string, workspaceId: string, instanceId: string) {
  await requireManager(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const loaded = await loadKey(db, instanceId, workspaceId)
  await db.delete(integrations).where(eq(integrations.id, loaded.instance.integrationId))
}

export async function testImmichConnection(db: Database, userId: string, workspaceId: string, input: { instanceId?: string; internalUrl: string; apiKey?: string }) {
  await requireManager(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const internalUrl = immichBaseUrl(input.internalUrl)
  let apiKey = input.apiKey?.trim() ?? ''
  if ((!apiKey || apiKey === savedSecret) && input.instanceId) apiKey = (await loadKey(db, input.instanceId, workspaceId)).apiKey
  const result = await probeImmich(internalUrl, apiKey)
  return { ok: true, version: result.version, user: result.user }
}

export async function syncImmichInstance(db: Database, instanceId: string, workspaceId?: string) {
  const [owned] = await db
    .select({ workspaceId: integrations.workspaceId })
    .from(immichInstances)
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(eq(immichInstances.id, instanceId))
    .limit(1)
  if (!owned) throw new AppError(404, 'Immich connection not found')
  const scope = workspaceId ?? owned.workspaceId
  await assertImmich(db, scope)
  const { instance, apiKey } = await loadKey(db, instanceId, scope)
  const [job] = await db.insert(syncJobs).values({ integrationId: instance.integrationId, kind: 'immich-people', status: 'running', startedAt: new Date() }).returning()
  try {
    const remote = await fetchAllPeople(instance.internalUrl, apiKey)
    const seen = new Set<string>()
    for (const person of remote) {
      seen.add(person.id)
      await db
        .insert(immichPeople)
        .values({
          instanceId: instance.id,
          externalId: person.id,
          name: person.name || null,
          thumbnailPath: person.thumbnailPath || null,
          isHidden: person.isHidden,
          raw: { missing: false },
        })
        .onConflictDoUpdate({
          target: [immichPeople.instanceId, immichPeople.externalId],
          set: { name: person.name || null, thumbnailPath: person.thumbnailPath || null, isHidden: person.isHidden, raw: { missing: false }, updatedAt: new Date() },
        })
    }
    const local = await db.select().from(immichPeople).where(eq(immichPeople.instanceId, instance.id))
    let missing = 0
    for (const person of local) {
      if (seen.has(person.externalId) || isMissing(person.raw)) continue
      missing += 1
      await db.update(immichPeople).set({ raw: { missing: true }, updatedAt: new Date() }).where(eq(immichPeople.id, person.id))
    }
    const syncedAt = new Date()
    await db.update(immichInstances).set({ status: 'connected', lastSyncedAt: syncedAt }).where(eq(immichInstances.id, instance.id))
    await db.update(integrations).set({ status: 'connected', lastSyncedAt: syncedAt, settings: { lastError: null }, updatedAt: syncedAt }).where(eq(integrations.id, instance.integrationId))
    if (job) await db.update(syncJobs).set({ status: 'succeeded', finishedAt: syncedAt }).where(eq(syncJobs.id, job.id))
    return { people: remote.length, missing }
  } catch (caught) {
    const message = caught instanceof AppError ? caught.message : 'Immich sync failed'
    await db.update(immichInstances).set({ status: 'error' }).where(eq(immichInstances.id, instance.id))
    await db.update(integrations).set({ status: 'error', settings: { lastError: message }, updatedAt: new Date() }).where(eq(integrations.id, instance.integrationId))
    if (job) await db.update(syncJobs).set({ status: 'failed', error: message, finishedAt: new Date() }).where(eq(syncJobs.id, job.id))
    throw caught instanceof AppError ? caught : new AppError(502, message)
  }
}

export async function syncWorkspaceImmich(db: Database, userId: string, workspaceId: string, instanceId: string) {
  await requireManager(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  return syncImmichInstance(db, instanceId, workspaceId)
}

export async function syncDueImmich(db: Database) {
  const enabled = await db
    .select({ workspaceId: integrations.workspaceId })
    .from(integrations)
    .where(and(eq(integrations.provider, 'addon'), eq(integrations.name, 'immich'), eq(integrations.status, 'enabled')))
  const allowed = new Set(enabled.map((row) => row.workspaceId))
  const rows = await db
    .select({ id: immichInstances.id, lastSyncedAt: immichInstances.lastSyncedAt, workspaceId: integrations.workspaceId })
    .from(immichInstances)
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
  const cutoff = Date.now() - 6 * 60 * 60 * 1000
  for (const row of rows) {
    if (!allowed.has(row.workspaceId)) continue
    if (row.lastSyncedAt && row.lastSyncedAt.getTime() > cutoff) continue
    try {
      await syncImmichInstance(db, row.id)
    } catch (caught) {
      console.warn(caught instanceof Error ? caught.message : 'Immich sync failed')
    }
  }
}

export async function searchImmichPeople(db: Database, userId: string, workspaceId: string, query: string) {
  await requireMembership(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const needle = query.trim()
  const rows = await db
    .select({
      id: immichPeople.id,
      name: immichPeople.name,
      raw: immichPeople.raw,
      instanceName: immichInstances.name,
      contactId: contacts.id,
      displayName: contacts.displayName,
    })
    .from(immichPeople)
    .innerJoin(immichInstances, eq(immichInstances.id, immichPeople.instanceId))
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .leftJoin(contactExternalIdentities, and(eq(contactExternalIdentities.instanceId, immichInstances.id), eq(contactExternalIdentities.externalId, immichPeople.externalId), eq(contactExternalIdentities.provider, 'immich')))
    .leftJoin(contacts, and(eq(contacts.id, contactExternalIdentities.contactId), isNull(contacts.deletedAt)))
    .where(and(eq(integrations.workspaceId, workspaceId), eq(immichPeople.isHidden, false), ...(needle ? [ilike(immichPeople.name, `%${needle}%`)] : [])))
    .orderBy(asc(immichPeople.name))
    .limit(30)
  return rows.map((row) => ({
    id: row.id,
    name: row.name || 'Unnamed person',
    instanceName: row.instanceName,
    missing: isMissing(row.raw),
    linkedContact: row.contactId && row.displayName ? { id: row.contactId, displayName: row.displayName } : null,
  }))
}

async function rememberAssets(db: Database, instanceId: string, assets: RemoteAsset[]) {
  const saved = []
  for (const asset of assets) {
    const takenAt = asset.takenAt ? new Date(asset.takenAt) : null
    const [row] = await db
      .insert(immichAssets)
      .values({
        instanceId,
        externalId: asset.id,
        kind: asset.type,
        takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
        raw: {},
      })
      .onConflictDoUpdate({
        target: [immichAssets.instanceId, immichAssets.externalId],
        set: { kind: asset.type, takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null, updatedAt: new Date() },
      })
      .returning()
    if (row) saved.push(row)
  }
  return saved
}

export async function contactImmich(db: Database, userId: string, workspaceId: string, contactId: string) {
  const contact = await getContact(db, userId, workspaceId, contactId)
  if (!(await addonEnabled(db, workspaceId, 'immich'))) {
    return { enabled: false, connected: false, links: [], suggestions: [], attachments: [] }
  }
  const instances = await db
    .select({ id: immichInstances.id })
    .from(immichInstances)
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(eq(integrations.workspaceId, workspaceId))
  const links = await db
    .select({
      identityId: contactExternalIdentities.id,
      personId: immichPeople.id,
      externalId: immichPeople.externalId,
      name: immichPeople.name,
      raw: immichPeople.raw,
      instanceId: immichInstances.id,
      instanceName: immichInstances.name,
      externalUrl: immichInstances.externalUrl,
    })
    .from(contactExternalIdentities)
    .innerJoin(immichInstances, eq(immichInstances.id, contactExternalIdentities.instanceId))
    .innerJoin(immichPeople, and(eq(immichPeople.instanceId, immichInstances.id), eq(immichPeople.externalId, contactExternalIdentities.externalId)))
    .where(and(eq(contactExternalIdentities.contactId, contactId), eq(contactExternalIdentities.provider, 'immich')))
  const galleries = []
  for (const link of links) {
    const personUrl = `${link.externalUrl.replace(/\/$/, '')}/people/${link.externalId}`
    try {
      const { instance, apiKey } = await loadKey(db, link.instanceId, workspaceId)
      const [videos, recent] = await Promise.all([
        searchAssets(instance.internalUrl, apiKey, link.externalId, 'VIDEO', 1),
        searchAssets(instance.internalUrl, apiKey, link.externalId, undefined, 12),
      ])
      let photoCount = 0
      try {
        const stats = await immichJson(instance.internalUrl, apiKey, `/api/people/${link.externalId}/statistics`)
        const total = stats && typeof stats === 'object' && typeof (stats as { assets?: unknown }).assets === 'number' ? (stats as { assets: number }).assets : recent.total
        photoCount = Math.max(0, total - videos.total)
      } catch {
        photoCount = recent.items.filter((item) => item.type !== 'VIDEO').length
      }
      const stored = await rememberAssets(db, instance.id, recent.items)
      galleries.push({
        identityId: link.identityId,
        personId: link.personId,
        name: link.name || 'Unnamed person',
        missing: isMissing(link.raw),
        instanceName: link.instanceName,
        personUrl,
        photoCount,
        videoCount: videos.total,
        error: null as string | null,
        assets: stored.map((asset) => ({
          id: asset.id,
          kind: asset.kind || 'IMAGE',
          takenAt: asset.takenAt?.toISOString() ?? null,
          photoUrl: `${link.externalUrl.replace(/\/$/, '')}/photos/${asset.externalId}`,
        })),
      })
    } catch (caught) {
      galleries.push({
        identityId: link.identityId,
        personId: link.personId,
        name: link.name || 'Unnamed person',
        missing: isMissing(link.raw),
        instanceName: link.instanceName,
        personUrl,
        photoCount: 0,
        videoCount: 0,
        error: caught instanceof Error ? caught.message : 'Immich could not be reached',
        assets: [],
      })
    }
  }
  const people = await db
    .select({ id: immichPeople.id, name: immichPeople.name, instanceName: immichInstances.name, externalId: immichPeople.externalId, instanceId: immichInstances.id })
    .from(immichPeople)
    .innerJoin(immichInstances, eq(immichInstances.id, immichPeople.instanceId))
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(and(eq(integrations.workspaceId, workspaceId), eq(immichPeople.isHidden, false)))
  const linked = new Set(links.map((link) => `${link.instanceId}:${link.externalId}`))
  const names = [contact.displayName, contact.nickname, contact.preferredName]
  const suggestions = people
    .filter((person) => !linked.has(`${person.instanceId}:${person.externalId}`) && immichNameScore(person.name || '', names) >= 80)
    .slice(0, 5)
    .map((person) => ({ personId: person.id, name: person.name || 'Unnamed person', instanceName: person.instanceName }))
  const activityRows = await db
    .select({ activityId: activityAssets.activityId, assetId: activityAssets.immichAssetId })
    .from(activityAssets)
    .innerJoin(activityContacts, eq(activityContacts.activityId, activityAssets.activityId))
    .where(eq(activityContacts.contactId, contactId))
  return { enabled: true, connected: instances.length > 0, links: galleries, suggestions, attachments: activityRows }
}

export async function linkImmichPerson(db: Database, userId: string, workspaceId: string, contactId: string, personId: string) {
  await requireWriter(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  await getContact(db, userId, workspaceId, contactId)
  const [person] = await db
    .select({ id: immichPeople.id, externalId: immichPeople.externalId, instanceId: immichPeople.instanceId })
    .from(immichPeople)
    .innerJoin(immichInstances, eq(immichInstances.id, immichPeople.instanceId))
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(and(eq(immichPeople.id, personId), eq(integrations.workspaceId, workspaceId)))
    .limit(1)
  if (!person) throw new AppError(404, 'Immich person not found. Sync Immich from Admin.')
  const [existing] = await db
    .select({ contactId: contactExternalIdentities.contactId })
    .from(contactExternalIdentities)
    .where(and(eq(contactExternalIdentities.instanceId, person.instanceId), eq(contactExternalIdentities.externalId, person.externalId)))
    .limit(1)
  if (existing && existing.contactId !== contactId) throw new AppError(409, 'That Immich person is already linked to someone else')
  if (existing) return { ok: true }
  await db.insert(contactExternalIdentities).values({ contactId, provider: 'immich', instanceId: person.instanceId, externalId: person.externalId })
  return { ok: true }
}

export async function unlinkImmichPerson(db: Database, userId: string, workspaceId: string, contactId: string, identityId: string) {
  await requireWriter(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  await getContact(db, userId, workspaceId, contactId)
  const [row] = await db
    .select({ id: contactExternalIdentities.id })
    .from(contactExternalIdentities)
    .innerJoin(immichInstances, eq(immichInstances.id, contactExternalIdentities.instanceId))
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(and(eq(contactExternalIdentities.id, identityId), eq(contactExternalIdentities.contactId, contactId), eq(integrations.workspaceId, workspaceId)))
    .limit(1)
  if (!row) throw new AppError(404, 'Link not found')
  await db.delete(contactExternalIdentities).where(eq(contactExternalIdentities.id, row.id))
}

async function workspaceImage(db: Database, workspaceId: string, target: { personId?: string; assetId?: string }) {
  if (target.personId) {
    const [person] = await db
      .select({ externalId: immichPeople.externalId, instanceId: immichPeople.instanceId })
      .from(immichPeople)
      .innerJoin(immichInstances, eq(immichInstances.id, immichPeople.instanceId))
      .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
      .where(and(eq(immichPeople.id, target.personId), eq(integrations.workspaceId, workspaceId)))
      .limit(1)
    if (!person) throw new AppError(404, 'Immich person not found')
    const { instance, apiKey } = await loadKey(db, person.instanceId, workspaceId)
    const response = await immichRequest(instance.internalUrl, apiKey, `/api/people/${person.externalId}/thumbnail`)
    return readImage(response)
  }
  if (!target.assetId) throw new AppError(400, 'Choose a photo')
  const [asset] = await db
    .select({ externalId: immichAssets.externalId, instanceId: immichAssets.instanceId })
    .from(immichAssets)
    .innerJoin(immichInstances, eq(immichInstances.id, immichAssets.instanceId))
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(and(eq(immichAssets.id, target.assetId), eq(integrations.workspaceId, workspaceId)))
    .limit(1)
  if (!asset) throw new AppError(404, 'Photo not found')
  const { instance, apiKey } = await loadKey(db, asset.instanceId, workspaceId)
  const response = await immichRequest(instance.internalUrl, apiKey, `/api/assets/${asset.externalId}/thumbnail?size=thumbnail`)
  return readImage(response)
}

async function readImage(response: Response) {
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 5_000_000) throw new AppError(502, 'Immich sent a thumbnail that is too large')
  const header = response.headers.get('content-type') || ''
  const contentType = header.startsWith('image/') ? header.split(';')[0]! : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : ''
  if (!contentType) throw new AppError(502, 'Immich did not return an image')
  return { bytes, contentType }
}

export async function readImmichImage(db: Database, userId: string, workspaceId: string, target: { personId?: string; assetId?: string }) {
  await requireMembership(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  return workspaceImage(db, workspaceId, target)
}

export async function readImmichProfileImage(db: Database, userId: string, workspaceId: string, target: { personId?: string; assetId?: string }) {
  await requireWriter(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  return workspaceImage(db, workspaceId, target)
}

export async function attachImmichAsset(db: Database, userId: string, workspaceId: string, activityId: string, assetId: string) {
  await requireWriter(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const [activity] = await db.select({ id: activities.id }).from(activities).where(and(eq(activities.id, activityId), eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt))).limit(1)
  if (!activity) throw new AppError(404, 'Interaction not found')
  const [asset] = await db
    .select({ id: immichAssets.id })
    .from(immichAssets)
    .innerJoin(immichInstances, eq(immichInstances.id, immichAssets.instanceId))
    .innerJoin(integrations, eq(integrations.id, immichInstances.integrationId))
    .where(and(eq(immichAssets.id, assetId), eq(integrations.workspaceId, workspaceId)))
    .limit(1)
  if (!asset) throw new AppError(404, 'Photo not found')
  await db.insert(activityAssets).values({ activityId, immichAssetId: assetId }).onConflictDoNothing()
  return { ok: true }
}

export async function detachImmichAsset(db: Database, userId: string, workspaceId: string, activityId: string, assetId: string) {
  await requireWriter(db, userId, workspaceId)
  await assertImmich(db, workspaceId)
  const [activity] = await db.select({ id: activities.id }).from(activities).where(and(eq(activities.id, activityId), eq(activities.workspaceId, workspaceId))).limit(1)
  if (!activity) throw new AppError(404, 'Interaction not found')
  await db.delete(activityAssets).where(and(eq(activityAssets.activityId, activityId), eq(activityAssets.immichAssetId, assetId)))
}
