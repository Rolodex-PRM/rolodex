import { AppError } from './errors'

export type MapProvider = 'osm' | 'mapbox' | 'google'

export type PlaceSuggestion = {
  id: string
  label: string
  street: string
  city: string
  region: string
  postalCode: string
  country: string
  lat: number | null
  lon: number | null
  provider: MapProvider
}

export function placeProviders() {
  return { osm: true, google: Boolean(process.env.GOOGLE_MAPS_API_KEY), mapbox: Boolean(process.env.MAPBOX_ACCESS_TOKEN) }
}

export async function searchPlaces(query: string, provider: MapProvider = 'osm', token = '') {
  const q = query.trim()
  if (q.length < 2) return []
  if (provider === 'mapbox') return mapboxSuggestions(q, token)
  if (provider === 'google') return googleSuggestions(q, token)
  return osmSuggestions(q)
}

export async function placeDetails(provider: 'google', id: string, token = '') {
  const key = googleKey(token)
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(id)}&fields=address_component,formatted_address,geometry&key=${encodeURIComponent(key)}`,
  )
  if (!response.ok) throw new AppError(502, 'Google could not look up that address')
  const body = (await response.json()) as {
    status?: string
    result?: { formatted_address?: string; address_components?: GoogleComponent[]; geometry?: { location?: { lat?: number; lng?: number } } }
  }
  if (body.status !== 'OK' || !body.result) throw new AppError(404, 'Address was not found')
  return fromGoogle(id, body.result.formatted_address ?? '', body.result.address_components ?? [], body.result.geometry?.location?.lat ?? null, body.result.geometry?.location?.lng ?? null)
}

export async function reversePlace(lat: number, lon: number, provider: MapProvider, token = '') {
  if (provider === 'mapbox') return mapboxReverse(lat, lon, token)
  if (provider === 'google') return googleReverse(lat, lon, token)
  return osmReverse(lat, lon)
}

async function osmSuggestions(query: string): Promise<PlaceSuggestion[]> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`,
    { headers: osmHeaders() },
  )
  if (!response.ok) throw new AppError(502, 'OpenStreetMap could not search addresses')
  const rows = (await response.json()) as OsmPlace[]
  return rows.map(fromOsm)
}

async function osmReverse(lat: number, lon: number) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
    { headers: osmHeaders() },
  )
  if (!response.ok) throw new AppError(502, 'OpenStreetMap could not look up that point')
  const row = (await response.json()) as OsmPlace
  if (!row.display_name) return null
  return fromOsm(row)
}

function fromOsm(row: OsmPlace): PlaceSuggestion {
  return {
    id: String(row.place_id),
    label: row.display_name,
    street: [row.address?.house_number, row.address?.road].filter(Boolean).join(' '),
    city: row.address?.city || row.address?.town || row.address?.village || row.address?.hamlet || '',
    region: row.address?.state || '',
    postalCode: row.address?.postcode || '',
    country: row.address?.country || '',
    lat: numberOrNull(row.lat),
    lon: numberOrNull(row.lon),
    provider: 'osm',
  }
}

async function mapboxSuggestions(query: string, token: string) {
  const key = mapboxKey(token)
  const response = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=5&types=address&access_token=${encodeURIComponent(key)}`,
  )
  if (!response.ok) throw new AppError(502, 'Mapbox could not search addresses')
  const body = (await response.json()) as { features?: MapboxFeature[]; message?: string }
  return (body.features ?? []).map(fromMapbox)
}

async function mapboxReverse(lat: number, lon: number, token: string) {
  const key = mapboxKey(token)
  const response = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(`${lon},${lat}`)}.json?limit=1&types=address&access_token=${encodeURIComponent(key)}`,
  )
  if (!response.ok) throw new AppError(502, 'Mapbox could not look up that point')
  const body = (await response.json()) as { features?: MapboxFeature[] }
  const feature = body.features?.[0]
  return feature ? fromMapbox(feature) : null
}

function fromMapbox(feature: MapboxFeature): PlaceSuggestion {
  const context = (prefix: string) => feature.context?.find((item) => item.id.startsWith(prefix))
  const region = context('region')
  const short = region?.short_code?.split('-').pop()
  return {
    id: feature.id,
    label: feature.place_name,
    street: [feature.address, feature.text].filter(Boolean).join(' '),
    city: context('place')?.text || context('locality')?.text || '',
    region: short ? short.toUpperCase() : region?.text || '',
    postalCode: context('postcode')?.text || '',
    country: context('country')?.text || '',
    lat: feature.center[1] ?? null,
    lon: feature.center[0] ?? null,
    provider: 'mapbox',
  }
}

async function googleSuggestions(query: string, token: string): Promise<PlaceSuggestion[]> {
  const key = googleKey(token)
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&key=${encodeURIComponent(key)}`,
  )
  if (!response.ok) throw new AppError(502, 'Google could not search addresses')
  const body = (await response.json()) as { status?: string; predictions?: { description: string; place_id: string }[]; error_message?: string }
  if (body.status === 'REQUEST_DENIED') throw new AppError(502, body.error_message || 'Google rejected the address search')
  return (body.predictions ?? []).slice(0, 5).map((row) => ({
    id: row.place_id,
    label: row.description,
    street: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
    lat: null,
    lon: null,
    provider: 'google' as const,
  }))
}

async function googleReverse(lat: number, lon: number, token: string) {
  const key = googleKey(token)
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lon}`)}&key=${encodeURIComponent(key)}`,
  )
  if (!response.ok) throw new AppError(502, 'Google could not look up that point')
  const body = (await response.json()) as { status?: string; results?: GoogleResult[]; error_message?: string }
  if (body.status === 'REQUEST_DENIED') throw new AppError(502, body.error_message || 'Google rejected the map lookup')
  const result = body.results?.[0]
  if (!result) return null
  return fromGoogle(result.place_id, result.formatted_address, result.address_components ?? [], result.geometry?.location?.lat ?? lat, result.geometry?.location?.lng ?? lon)
}

function fromGoogle(id: string, label: string, components: GoogleComponent[], lat: number | null, lon: number | null): PlaceSuggestion {
  const part = (type: string, short = false) => {
    const component = components.find((item) => item.types.includes(type))
    return (short ? component?.short_name : component?.long_name) ?? ''
  }
  return {
    id,
    label,
    street: [part('street_number'), part('route')].filter(Boolean).join(' '),
    city: part('locality') || part('postal_town') || part('sublocality'),
    region: part('administrative_area_level_1', true),
    postalCode: part('postal_code'),
    country: part('country'),
    lat,
    lon,
    provider: 'google',
  }
}

function googleKey(token: string) {
  const key = token || process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new AppError(400, 'Add a Google Maps API key in Admin')
  return key
}

function mapboxKey(token: string) {
  const key = token || process.env.MAPBOX_ACCESS_TOKEN
  if (!key) throw new AppError(400, 'Add a Mapbox token in Admin')
  return key
}

function osmHeaders() {
  return { 'User-Agent': 'Rolodex/0.1 (self-hosted address book)', Accept: 'application/json' }
}

function numberOrNull(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

type OsmPlace = {
  place_id: number
  display_name: string
  lat?: string
  lon?: string
  address?: {
    house_number?: string
    road?: string
    city?: string
    town?: string
    village?: string
    hamlet?: string
    state?: string
    postcode?: string
    country?: string
  }
}

type MapboxFeature = {
  id: string
  place_name: string
  center: [number, number]
  address?: string
  text?: string
  context?: { id: string; text: string; short_code?: string }[]
}

type GoogleComponent = { long_name: string; short_name?: string; types: string[] }
type GoogleResult = {
  place_id: string
  formatted_address: string
  address_components?: GoogleComponent[]
  geometry?: { location?: { lat?: number; lng?: number } }
}
