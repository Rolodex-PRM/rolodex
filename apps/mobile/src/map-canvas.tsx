import { createElement, useEffect, useRef } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import type { MapSettings } from './api'
import { alamo, mapboxStyle, tileTemplate } from './map-themes'
import { font, theme } from './theme'

type Point = { lat: number; lon: number }
type LeafletMap = { remove: () => void; setView: (center: [number, number], zoom?: number) => void; invalidateSize: () => void; getContainer?: () => HTMLElement }
type LeafletMarker = {
  setLatLng: (point: [number, number]) => void
  on: (event: string, handler: () => void) => void
  getLatLng: () => { lat: number; lng: number }
  dragging?: { enable: () => void; disable: () => void }
}
type GlMap = { remove: () => void; setCenter: (center: [number, number]) => void; resize: () => void; on: (event: string, handler: () => void) => void }
type GlMarker = {
  setLngLat: (point: [number, number]) => GlMarker
  addTo: (map: GlMap) => GlMarker
  setDraggable: (value: boolean) => void
  on: (event: string, handler: () => void) => void
  getLngLat: () => { lat: number; lng: number }
}
type GlApi = {
  Map: new (options: { container: HTMLElement; style: string; center: [number, number]; zoom: number; attributionControl: boolean }) => GlMap
  Marker: new (options: { color: string; draggable: boolean }) => GlMarker
}

const pin =
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 24 36"><path fill="#e11d2e" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>'

export function MapCanvas({
  settings,
  point = alamo,
  adjusting = false,
  onMove,
  height = 360,
}: {
  settings: MapSettings
  point?: Point
  adjusting?: boolean
  onMove?: (lat: number, lon: number) => void
  height?: number
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const onMoveRef = useRef(onMove)
  const adjustingRef = useRef(adjusting)
  const pointRef = useRef(point)
  const skipView = useRef(false)
  const marker = useRef<LeafletMarker | GlMarker | null>(null)
  const map = useRef<LeafletMap | GlMap | null>(null)
  onMoveRef.current = onMove
  adjustingRef.current = adjusting
  pointRef.current = point
  const needsToken = settings.engine === 'mapbox' && !settings.mapboxToken

  useEffect(() => {
    if (Platform.OS !== 'web' || needsToken) return
    const node = host.current
    if (!node) return
    let cancelled = false
    const report = (lat: number, lon: number) => {
      if (!onMoveRef.current) return
      skipView.current = true
      onMoveRef.current(lat, lon)
    }
    const ready = settings.engine === 'leaflet'
      ? mountLeaflet(node, pointRef.current, settings.tileUrl, settings.cartoKey, marker, map, report, () => cancelled)
      : mountVector(node, pointRef.current, settings, marker, map, report, () => cancelled)
    void ready.then(() => {
      if (cancelled || !marker.current) return
      setDragging(marker.current, adjustingRef.current)
      moveMarker(marker.current, map.current, pointRef.current, false)
    })
    return () => {
      cancelled = true
      void ready.then((dispose) => dispose?.())
      marker.current = null
      map.current = null
    }
  }, [settings.engine, settings.tileUrl, settings.cartoKey, settings.mapboxToken, needsToken])

  useEffect(() => {
    if (!marker.current) return
    setDragging(marker.current, adjusting)
    moveMarker(marker.current, map.current, point, !skipView.current)
    skipView.current = false
  }, [point, adjusting])

  if (needsToken) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Add a Mapbox access token to show this map.</Text>
      </View>
    )
  }
  if (Platform.OS !== 'web') return <View style={[styles.empty, { height }]} />
  return createElement('div', { ref: host, style: { height, width: '100%' } })
}

function setDragging(marker: LeafletMarker | GlMarker, adjusting: boolean) {
  if ('setLatLng' in marker) marker.dragging?.[adjusting ? 'enable' : 'disable']()
  else marker.setDraggable(adjusting)
}

function moveMarker(marker: LeafletMarker | GlMarker, map: LeafletMap | GlMap | null, point: Point, pan: boolean) {
  if ('setLatLng' in marker) {
    marker.setLatLng([point.lat, point.lon])
    if (pan && map && 'setView' in map) map.setView([point.lat, point.lon])
    return
  }
  marker.setLngLat([point.lon, point.lat])
  if (pan && map && 'setCenter' in map) map.setCenter([point.lon, point.lat])
}

async function mountLeaflet(
  node: HTMLDivElement,
  point: Point,
  tileUrl: string,
  cartoKey: string,
  marker: { current: LeafletMarker | GlMarker | null },
  map: { current: LeafletMap | GlMap | null },
  report: (lat: number, lon: number) => void,
  cancelled: () => boolean,
) {
  ensureStylesheet('leaflet-css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
  const loaded = await import('leaflet')
  if (cancelled()) return
  const L = ('default' in loaded && loaded.default ? loaded.default : loaded) as typeof import('leaflet')
  const tiles = tileTemplate(tileUrl, cartoKey)
  const view = L.map(node, { zoomControl: true }).setView([point.lat, point.lon], 15)
  L.tileLayer(tiles.url, {
    attribution: tiles.attribution,
    maxZoom: 20,
    subdomains: 'abc',
    detectRetina: tiles.url.includes('{r}'),
    referrerPolicy: 'origin',
  }).addTo(view)
  const icon = L.divIcon({ className: '', html: pin, iconSize: [28, 40], iconAnchor: [14, 40] })
  const pinMarker = L.marker([point.lat, point.lon], { icon, draggable: true }).addTo(view)
  pinMarker.dragging?.disable()
  pinMarker.on('dragend', () => {
    const next = pinMarker.getLatLng()
    report(next.lat, next.lng)
  })
  const timer = window.setTimeout(() => {
    if (cancelled() || !node.isConnected) return
    view.invalidateSize()
  }, 250)
  map.current = view
  marker.current = pinMarker
  return () => {
    window.clearTimeout(timer)
    view.remove()
  }
}

async function mountVector(
  node: HTMLDivElement,
  point: Point,
  settings: MapSettings,
  marker: { current: LeafletMarker | GlMarker | null },
  map: { current: LeafletMap | GlMap | null },
  report: (lat: number, lon: number) => void,
  cancelled: () => boolean,
) {
  const gl = await loadMapLibre()
  if (cancelled()) return
  const style = settings.engine === 'mapbox'
    ? mapboxStyle(settings.tileUrl, settings.mapboxToken)
    : settings.tileUrl.trim() || 'https://tiles.openfreemap.org/styles/liberty'
  const view = new gl.Map({ container: node, style, center: [point.lon, point.lat], zoom: 15, attributionControl: true })
  const pinMarker = new gl.Marker({ color: '#e11d2e', draggable: true }).setLngLat([point.lon, point.lat]).addTo(view)
  pinMarker.setDraggable(false)
  pinMarker.on('dragend', () => {
    const next = pinMarker.getLngLat()
    report(next.lat, next.lng)
  })
  view.on('load', () => view.resize())
  map.current = view
  marker.current = pinMarker
  return () => view.remove()
}

function loadMapLibre() {
  const current = (window as unknown as { maplibregl?: GlApi }).maplibregl
  if (current) return Promise.resolve(current)
  ensureStylesheet('maplibre-css', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css')
  return new Promise<GlApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'
    script.onload = () => {
      const api = (window as unknown as { maplibregl?: GlApi }).maplibregl
      if (api) resolve(api)
      else reject(new Error('MapLibre did not load'))
    }
    script.onerror = () => reject(new Error('MapLibre could not load'))
    document.head.appendChild(script)
  })
}

function ensureStylesheet(id: string, href: string) {
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: theme.raised },
  emptyText: { fontFamily: font, color: theme.muted, textAlign: 'center' },
})
