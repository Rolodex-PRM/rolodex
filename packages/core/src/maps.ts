import { integrations } from '@rolodex/db'
import { and, eq } from 'drizzle-orm'
import { requireManager, requireMembership, type Db } from './access'
import { AppError } from './errors'
import { canManageMembers } from './permissions'
import { placeDetails, reversePlace, searchPlaces, type PlaceSuggestion } from './places'

export const savedSecret = '*********'
export const mapEngines = ['leaflet', 'mapbox', 'maplibre'] as const
export type MapEngine = (typeof mapEngines)[number]

export type MapSettings = {
  engine: MapEngine
  templateId: string
  tileUrl: string
  cartoKey: string
  mapboxToken: string
  googleKey: string
}

export async function getMapSettings(db: Db, userId: string, workspaceId: string): Promise<MapSettings> {
  const member = await requireMembership(db, userId, workspaceId)
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'map')))
    .limit(1)
  const settings = readSettings(row?.settings)
  if (!canManageMembers(member.role)) return { ...settings, googleKey: '' }
  return hideGoogleKey(settings)
}

export async function updateMapSettings(db: Db, userId: string, workspaceId: string, input: MapSettings): Promise<MapSettings> {
  await requireManager(db, userId, workspaceId)
  const [previousRow] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'map')))
    .limit(1)
  const previous = readSettings(previousRow?.settings)
  const settings: MapSettings = {
    engine: input.engine,
    templateId: input.templateId.trim() || 'osm',
    tileUrl: input.tileUrl.trim(),
    cartoKey: mergeSecret(input.cartoKey, previous.cartoKey),
    mapboxToken: mergeSecret(input.mapboxToken, previous.mapboxToken),
    googleKey: mergeSecret(input.googleKey, previous.googleKey),
  }
  if (settings.engine === 'mapbox' && !settings.mapboxToken) throw new AppError(400, 'Add a Mapbox access token')
  if (previousRow) {
    await db.update(integrations).set({ settings, status: 'connected', updatedAt: new Date() }).where(eq(integrations.id, previousRow.id))
  } else {
    await db.insert(integrations).values({ workspaceId, provider: 'map', name: 'Map', status: 'connected', settings })
  }
  return hideGoogleKey(settings)
}

function mergeSecret(next: string, previous: string) {
  const value = next.trim()
  if (value === savedSecret) return previous
  return value
}

function hideGoogleKey(settings: MapSettings): MapSettings {
  return { ...settings, googleKey: settings.googleKey ? savedSecret : '' }
}

export async function searchWorkspacePlaces(db: Db, userId: string, workspaceId: string, query: string) {
  const map = await loadMap(db, userId, workspaceId)
  const [osm, google] = await Promise.all([
    searchPlaces(query, 'osm').catch(() => [] as PlaceSuggestion[]),
    map.googleKey ? searchPlaces(query, 'google', map.googleKey).catch(() => [] as PlaceSuggestion[]) : Promise.resolve([] as PlaceSuggestion[]),
  ])
  const merged: PlaceSuggestion[] = []
  const count = Math.max(osm.length, google.length)
  for (let index = 0; index < count; index += 1) {
    const osmHit = osm[index]
    const googleHit = google[index]
    if (osmHit) merged.push(osmHit)
    if (googleHit) merged.push(googleHit)
  }
  return merged.slice(0, 8)
}

export async function workspacePlaceDetails(db: Db, userId: string, workspaceId: string, id: string): Promise<PlaceSuggestion> {
  const map = await loadMap(db, userId, workspaceId)
  if (!map.googleKey && !process.env.GOOGLE_MAPS_API_KEY) throw new AppError(400, 'Add a Google Maps API key in Admin')
  return placeDetails('google', id, map.googleKey)
}

export async function reverseWorkspacePlace(db: Db, userId: string, workspaceId: string, lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new AppError(400, 'A map point needs a latitude and longitude')
  await requireMembership(db, userId, workspaceId)
  const place = await reversePlace(lat, lon, 'osm')
  if (!place) throw new AppError(404, 'No address was found at that point')
  return place
}

async function loadMap(db: Db, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, 'map')))
    .limit(1)
  return readSettings(row?.settings)
}

function readSettings(value: unknown): MapSettings {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const engine = record.engine === 'mapbox' || record.engine === 'maplibre' ? record.engine : record.provider === 'mapbox' ? 'mapbox' : 'leaflet'
  const legacyToken = typeof record.token === 'string' ? record.token : ''
  return {
    engine,
    templateId: typeof record.templateId === 'string' ? record.templateId : engine === 'mapbox' ? 'streets' : engine === 'maplibre' ? 'liberty' : 'osm',
    tileUrl: typeof record.tileUrl === 'string' ? record.tileUrl : '',
    cartoKey: typeof record.cartoKey === 'string' ? record.cartoKey : '',
    mapboxToken: typeof record.mapboxToken === 'string' ? record.mapboxToken : engine === 'mapbox' ? legacyToken : '',
    googleKey: typeof record.googleKey === 'string' ? record.googleKey : record.provider === 'google' ? legacyToken : '',
  }
}
