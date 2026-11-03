export const alamo = { lat: 29.425967, lon: -98.486142, label: '300 Alamo Plaza, San Antonio, TX 78205' }

export type MapEngine = 'leaflet' | 'mapbox' | 'maplibre'

export type MapTheme = { id: string; name: string; url: string }

export const savedSecret = '*********'

export const leafletThemes: MapTheme[] = [
  { id: 'osm', name: 'OpenStreetMap', url: '' },
  { id: 'carto-positron', name: 'CartoDB Positron', url: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png' },
  { id: 'carto-dark', name: 'CartoDB Dark', url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png' },
  { id: 'carto-voyager', name: 'CartoDB Voyager', url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' },
  { id: 'opentopomap', name: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
]

export const mapboxThemes: MapTheme[] = [
  { id: 'streets', name: 'Streets', url: 'mapbox/streets-v12' },
  { id: 'light', name: 'Light', url: 'mapbox/light-v11' },
  { id: 'dark', name: 'Dark', url: 'mapbox/dark-v11' },
  { id: 'outdoors', name: 'Outdoors', url: 'mapbox/outdoors-v12' },
  { id: 'satellite', name: 'Satellite Streets', url: 'mapbox/satellite-streets-v12' },
]

export const maplibreThemes: MapTheme[] = [
  { id: 'liberty', name: 'Liberty', url: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'bright', name: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'positron', name: 'Positron', url: 'https://tiles.openfreemap.org/styles/positron' },
]

export function themesFor(engine: MapEngine) {
  if (engine === 'mapbox') return mapboxThemes
  if (engine === 'maplibre') return maplibreThemes
  return leafletThemes
}

export function tileTemplate(url: string, cartoKey: string) {
  const base = cartoTiles(url.trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png')
  const key = cartoKey.trim()
  const usable = key && key !== savedSecret
  const keyed = usable && base.includes('cartocdn.com') && !/[?&]key=/.test(base)
    ? `${base}${base.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`
    : base
  const attribution = base.includes('opentopomap')
    ? '© OpenStreetMap © OpenTopoMap'
    : base.includes('cartocdn.com')
      ? '© OpenStreetMap © CARTO'
      : '© OpenStreetMap'
  return { url: keyed, attribution }
}

function cartoTiles(url: string) {
  if (!url.includes('cartocdn.com')) return url
  const host = url.replace('{s}.', '').replace(/([?&])api_key=/, '$1key=')
  return host.replace(
    /basemaps\.cartocdn\.com\/(?!rastertiles\/|gl\/|vector\/)(dark_all|dark_nolabels|dark_only_labels|light_all|light_nolabels|light_only_labels|voyager|voyager_nolabels|voyager_only_labels)\//,
    'basemaps.cartocdn.com/rastertiles/$1/',
  )
}

export function mapboxStyle(styleId: string, token: string) {
  const id = styleId.trim() || 'mapbox/streets-v12'
  return `https://api.mapbox.com/styles/v1/${id}?access_token=${encodeURIComponent(token)}`
}
