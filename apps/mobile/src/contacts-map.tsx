import { createElement, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { api, apiUrl, send, type ContactSummary, type MapSettings, type Place } from './api'
import { AuthImage } from './immich-photos'
import { mapboxStyle, tileTemplate } from './map-themes'
import { font, theme } from './theme'

const emptyMap: MapSettings = { engine: 'leaflet', templateId: 'osm', tileUrl: '', cartoKey: '', mapboxToken: '', googleKey: '' }
const cacheKey = 'rolodex.address-points'

type Pin = { key: string; lat: number; lon: number; contacts: ContactSummary[] }

function addressKey(contact: ContactSummary) {
  const parts = [contact.street, contact.city, contact.region, contact.postalCode, contact.country].map((part) => (part ?? '').trim().toLowerCase())
  if (parts.every((part) => !part)) return ''
  return parts.join('|')
}

function addressQuery(contact: ContactSummary) {
  return [contact.street, contact.city, contact.region, contact.postalCode, contact.country].filter(Boolean).join(', ')
}

function readCache() {
  if (Platform.OS !== 'web') return {} as Record<string, { lat: number; lon: number }>
  try {
    return JSON.parse(sessionStorage.getItem(cacheKey) || '{}') as Record<string, { lat: number; lon: number }>
  } catch {
    return {}
  }
}

function writeCache(key: string, point: { lat: number; lon: number }) {
  const cache = readCache()
  cache[key] = point
  sessionStorage.setItem(cacheKey, JSON.stringify(cache))
}

function esc(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)
}

function initial(contact: ContactSummary) {
  const parts = contact.displayName.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return esc(parts[0]!.slice(0, 2).toUpperCase())
  return esc(`${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase())
}

function subtitle(contact: ContactSummary) {
  return [contact.title, contact.organizationName].filter(Boolean).join(' · ') || [contact.city, contact.region].filter(Boolean).join(', ')
}

function matches(contact: ContactSummary, needle: string) {
  if (!needle) return true
  const hay = [contact.displayName, contact.organizationName, contact.title, contact.city, contact.region, contact.country, contact.street].join(' ').toLowerCase()
  return hay.includes(needle)
}

function face(contact: ContactSummary, photos: Record<string, string>, size: number) {
  const photo = photos[contact.id]
  if (photo) return `<img alt="" src="${photo}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block" />`
  return `<span style="font-family:${font},sans-serif;font-weight:700;font-size:${Math.round(size * 0.38)}px;color:${theme.text}">${initial(contact)}</span>`
}

function markerHtml(pin: Pin, open: boolean, photos: Record<string, string>, selectedId: string) {
  const people = pin.contacts
  if (people.length === 1) {
    const person = people[0]!
    return `<button data-contact="${person.id}" title="${esc(person.displayName)}" style="${bubble(44, person.id === selectedId)}">${face(person, photos, 44)}</button>`
  }
  const count = `<button title="${people.length} people here" style="width:42px;height:42px;border-radius:50%;border:3px solid #fff;background:#2f6fed;color:#fff;font-family:${font},sans-serif;font-weight:700;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.28);cursor:pointer;padding:0">${people.length}</button>`
  if (!open) return count
  const radius = 36 + people.length * 8
  const start = people.length === 2 ? 0 : -Math.PI / 2
  const satellites = people.map((person, index) => {
    const angle = start + (index / people.length) * Math.PI * 2
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    return `<button data-contact="${person.id}" title="${esc(person.displayName)}" style="${bubble(40, person.id === selectedId)}position:absolute;left:50%;top:50%;transform:translate(calc(-50% + ${x}px), calc(-50% + ${y}px))">${face(person, photos, 40)}</button>`
  }).join('')
  return `<div style="position:relative;width:${radius * 2 + 48}px;height:${radius * 2 + 48}px"><div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">${count}</div>${satellites}</div>`
}

function bubble(size: number, selected: boolean) {
  const ring = selected ? 'box-shadow:0 0 0 3px #6d28d9, 0 2px 8px rgba(0,0,0,.28);' : 'box-shadow:0 2px 8px rgba(0,0,0,.28);'
  return `width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;${ring}background:#ececec;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;overflow:hidden;`
}

function markerSize(pin: Pin, open: boolean) {
  if (pin.contacts.length === 1 || !open) return 48
  const radius = 36 + pin.contacts.length * 8
  return radius * 2 + 48
}

export function ContactsMap({
  contacts,
  canWrite,
  onOpen,
}: {
  contacts: ContactSummary[]
  canWrite: boolean
  onOpen: (contact: ContactSummary) => void
}) {
  const host = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<{ remove: () => void; focus: (lat: number, lon: number) => void; draw: (pins: Pin[], openKey: string, photos: Record<string, string>, selectedId: string) => void } | null>(null)
  const pinsRef = useRef<Pin[]>([])
  const openRef = useRef('')
  const photosRef = useRef<Record<string, string>>({})
  const selectedRef = useRef('')
  const screen = useWindowDimensions()
  const wide = screen.width >= 980
  const frame = Math.max(420, screen.height - 400)
  const [settings, setSettings] = useState<MapSettings | null>(null)
  const [pins, setPins] = useState<Pin[]>([])
  const [openKey, setOpenKey] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')
  const placed = contacts.filter((contact) => addressKey(contact))
  pinsRef.current = pins
  openRef.current = openKey
  photosRef.current = photos
  selectedRef.current = selectedId
  const needle = query.trim().toLowerCase()
  const shown = pins
    .map((pin) => ({ ...pin, contacts: pin.contacts.filter((person) => matches(person, needle)) }))
    .filter((pin) => pin.contacts.length)
  const listed = shown.flatMap((pin) => pin.contacts)

  useEffect(() => {
    const node = host.current as (HTMLElement & {
      __rolodexOpen?: (contact: ContactSummary) => void
      __rolodexToggle?: (key: string) => void
      __rolodexClose?: () => void
      __rolodexPick?: (contact: ContactSummary) => void
    }) | null
    if (!node) return
    node.__rolodexOpen = onOpen
    node.__rolodexToggle = (key) => setOpenKey((current) => (!key || current === key ? '' : key))
    node.__rolodexClose = () => setOpenKey('')
    node.__rolodexPick = (contact) => {
      if (selectedRef.current === contact.id) onOpen(contact)
      else setSelectedId(contact.id)
    }
  }, [onOpen])
  const missing = contacts.length - placed.length

  useEffect(() => {
    const workspaceId = contacts[0]?.workspaceId
    if (!workspaceId) return
    api<MapSettings>(`/api/workspaces/${workspaceId}/map`).then(setSettings).catch(() => setSettings(emptyMap))
  }, [contacts])

  useEffect(() => {
    if (Platform.OS !== 'web') return
    let stop = false
    const photosNow: Record<string, string> = {}
    const urls: string[] = []
    const withPhoto = contacts.filter((contact) => contact.hasPhoto)
    void Promise.all(withPhoto.map(async (contact) => {
      const raw = sessionStorage.getItem('rolodex.session')
      const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
      const response = await fetch(`${apiUrl}/api/workspaces/${contact.workspaceId}/contacts/${contact.id}/photo`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: 'include',
      })
      if (!response.ok || stop) return
      const url = URL.createObjectURL(await response.blob())
      urls.push(url)
      photosNow[contact.id] = url
    })).then(() => {
      if (!stop) setPhotos(photosNow)
    })
    return () => {
      stop = true
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [contacts])

  useEffect(() => {
    if (Platform.OS !== 'web') return
    let stop = false
    async function place() {
      const groups = new Map<string, ContactSummary[]>()
      for (const contact of contacts) {
        const key = addressKey(contact)
        if (!key) continue
        groups.set(key, [...(groups.get(key) ?? []), contact])
      }
      const cache = readCache()
      const located: { key: string; lat: number; lon: number; contacts: ContactSummary[] }[] = []
      let index = 0
      for (const [key, people] of groups) {
        if (stop) return
        const stored = people.find((person) => person.lat != null && person.lon != null)
        let point = stored?.lat != null && stored.lon != null ? { lat: stored.lat, lon: stored.lon } : cache[key]
        if (!point) {
          if (index > 0) await new Promise((resolve) => setTimeout(resolve, 350))
          index += 1
          setStatus('Finding addresses…')
          const sample = people[0]!
          try {
            const rows = await api<Place[]>(`/api/workspaces/${sample.workspaceId}/places?q=${encodeURIComponent(addressQuery(sample))}`)
            let hit = rows.find((row) => row.lat != null && row.lon != null)
            if (!hit) {
              const google = rows.find((row) => row.provider === 'google')
              if (google) hit = await api<Place>(`/api/workspaces/${sample.workspaceId}/places/details?id=${encodeURIComponent(google.id)}`)
            }
            if (hit?.lat == null || hit.lon == null) continue
            point = { lat: hit.lat, lon: hit.lon }
            writeCache(key, point)
            if (canWrite) {
              for (const person of people) {
                if (person.lat != null) continue
                void send(`/api/workspaces/${person.workspaceId}/contacts/${person.id}/location`, 'PUT', point).catch(() => undefined)
              }
            }
          } catch {
            continue
          }
        }
        located.push({ key, lat: point.lat, lon: point.lon, contacts: people })
      }
      if (stop) return
      const buckets = new Map<string, Pin>()
      for (const item of located) {
        const bucket = `${item.lat.toFixed(4)},${item.lon.toFixed(4)}`
        const current = buckets.get(bucket)
        if (current) current.contacts.push(...item.contacts)
        else buckets.set(bucket, { key: bucket, lat: item.lat, lon: item.lon, contacts: [...item.contacts] })
      }
      setPins([...buckets.values()])
      setStatus('')
    }
    void place()
    return () => {
      stop = true
    }
  }, [contacts, canWrite])

  useEffect(() => {
    if (Platform.OS !== 'web' || !settings) return
    const node = host.current
    if (!node || (settings.engine === 'mapbox' && !settings.mapboxToken)) return
    let cancel = false
    const ready = settings.engine === 'leaflet' ? mountLeaflet(node, settings) : mountVector(node, settings)
    void ready.then((map) => {
      if (cancel || !map) return
      mapRef.current = map
      map.draw(shownRef.current, openRef.current, photosRef.current, selectedRef.current)
    })
    return () => {
      cancel = true
      void ready.then((map) => map?.remove())
      mapRef.current = null
    }
  }, [settings])

  const shownRef = useRef(shown)
  shownRef.current = shown

  const shownKey = shown.map((pin) => `${pin.key}:${pin.contacts.map((person) => person.id).join(',')}`).join('|')

  useEffect(() => {
    mapRef.current?.draw(shownRef.current, openRef.current, photosRef.current, selectedRef.current)
  }, [shownKey, openKey, photos, selectedId])

  useEffect(() => {
    if (!selectedId) return
    const pin = shownRef.current.find((item) => item.contacts.some((person) => person.id === selectedId))
    if (pin) mapRef.current?.focus(pin.lat, pin.lon)
  }, [selectedId])

  if (settings?.engine === 'mapbox' && !settings.mapboxToken) {
    return <Text style={styles.meta}>Add a Mapbox access token in Admin to show this map.</Text>
  }

  function pick(contact: ContactSummary) {
    if (selectedId === contact.id) onOpen(contact)
    else setSelectedId(contact.id)
  }

  return (
    <View style={[styles.stage, { height: wide ? frame : frame + 280 }, !wide && styles.stageStacked]}>
      <View style={styles.mapPane}>
        {Platform.OS === 'web' ? createElement('div', { ref: host, style: { height: '100%', width: '100%', background: '#e5e7eb' } }) : <View style={styles.empty} />}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by place or name"
          placeholderTextColor={theme.muted}
          style={styles.mapSearch}
        />
        {status ? <Text style={styles.finding}>{status}</Text> : null}
      </View>
      <View style={[styles.side, !wide && styles.sideStacked]}>
        <Text style={styles.count}>{listed.length} matching {listed.length === 1 ? 'contact' : 'contacts'}</Text>
        {missing ? <Text style={styles.sideMeta}>{missing} {missing === 1 ? 'person has' : 'people have'} no address, so they stay off the map.</Text> : null}
        <ScrollView style={styles.list}>
          {listed.map((contact) => {
            const selected = contact.id === selectedId
            return (
              <Pressable key={contact.id} onPress={() => pick(contact)} style={[styles.person, selected && styles.personOn]}>
                {contact.hasPhoto ? (
                  <AuthImage
                    path={`/api/workspaces/${contact.workspaceId}/contacts/${contact.id}/photo`}
                    size={36}
                    radius={18}
                    fallback={<View style={styles.avatar}><Text style={styles.avatarText}>{initial(contact)}</Text></View>}
                  />
                ) : (
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initial(contact)}</Text></View>
                )}
                <View style={styles.personCopy}>
                  <Text style={styles.personName} numberOfLines={1}>{contact.displayName}</Text>
                  {subtitle(contact) ? <Text style={styles.personMeta} numberOfLines={1}>{subtitle(contact)}</Text> : null}
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    </View>
  )
}

function mountLeaflet(node: HTMLDivElement, settings: MapSettings) {
  return import('leaflet').then((loaded) => {
    const L = ('default' in loaded && loaded.default ? loaded.default : loaded) as typeof import('leaflet')
    ensureStylesheet('leaflet-css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
    ensurePinStyle()
    const view = L.map(node, { zoomControl: false }).setView([29.425967, -98.486142], 4)
    L.control.zoom({ position: 'bottomright' }).addTo(view)
    const template = tileTemplate(settings.tileUrl, settings.cartoKey)
    L.tileLayer(template.url, {
      attribution: template.attribution,
      maxZoom: 20,
      subdomains: 'abc',
      detectRetina: template.url.includes('{r}'),
      referrerPolicy: 'origin',
    }).addTo(view)
    let skipMapClick = false
    view.on('click', () => {
      if (skipMapClick) return
      const close = (node as HTMLElement & { __rolodexClose?: () => void }).__rolodexClose
      close?.()
    })
    let layer: ReturnType<typeof L.layerGroup> | null = null
    let fitted = ''
    let sizeTimer = 0
    const refreshSize = () => {
      window.clearTimeout(sizeTimer)
      sizeTimer = window.setTimeout(() => {
        if (!node.isConnected) return
        view.invalidateSize()
      }, 200)
    }
    const api = {
      remove: () => {
        window.clearTimeout(sizeTimer)
        view.remove()
      },
      focus: (lat: number, lon: number) => view.flyTo([lat, lon], Math.max(view.getZoom(), 11), { duration: 0.5 }),
      draw: (pins: Pin[], openKey: string, photos: Record<string, string>, selectedId: string) => {
        layer?.remove()
        layer = L.layerGroup().addTo(view)
        for (const pin of pins) {
          const size = markerSize(pin, openKey === pin.key)
          const icon = L.divIcon({ className: 'rolodex-pin', html: markerHtml(pin, openKey === pin.key, photos, selectedId), iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
          const marker = L.marker([pin.lat, pin.lon], { icon, zIndexOffset: openKey === pin.key ? 1000 : 0 }).addTo(layer)
          marker.on('click', (event: { originalEvent: Event }) => {
            skipMapClick = true
            window.setTimeout(() => {
              skipMapClick = false
            }, 0)
            L.DomEvent.stopPropagation(event.originalEvent)
            const target = event.originalEvent.target
            const id = target instanceof Element ? target.closest('[data-contact]')?.getAttribute('data-contact') : ''
            const person = id ? pin.contacts.find((item) => item.id === id) : undefined
            if (person) openContactFrom(node, person)
            else togglePin(node, pin.key)
          })
        }
        const signature = pins.map((pin) => pin.key).join('|')
        if (pins.length && signature !== fitted) {
          fitted = signature
          view.fitBounds(L.latLngBounds(pins.map((pin) => [pin.lat, pin.lon])), { padding: [48, 48], maxZoom: 14 })
        }
        refreshSize()
      },
    }
    refreshSize()
    return api
  })
}

function mountVector(node: HTMLDivElement, settings: MapSettings) {
  return loadMapLibre().then((gl) => {
    const style = settings.engine === 'mapbox'
      ? mapboxStyle(settings.tileUrl, settings.mapboxToken)
      : settings.tileUrl.trim() || 'https://tiles.openfreemap.org/styles/liberty'
    const view = new gl.Map({ container: node, style, center: [-98.486142, 29.425967], zoom: 4, attributionControl: true })
    const markers: { remove: () => void }[] = []
    let fitted = ''
    view.on('click', () => togglePin(node, ''))
    return {
      remove: () => view.remove(),
      focus: (lat: number, lon: number) => view.flyTo({ center: [lon, lat], zoom: Math.max(view.getZoom(), 11) }),
      draw: (pins: Pin[], openKey: string, photos: Record<string, string>, selectedId: string) => {
        markers.splice(0).forEach((marker) => marker.remove())
        for (const pin of pins) {
          const element = document.createElement('div')
          element.innerHTML = markerHtml(pin, openKey === pin.key, photos, selectedId)
          element.onclick = (event) => {
            event.stopPropagation()
            const target = event.target
            const id = target instanceof Element ? target.closest('[data-contact]')?.getAttribute('data-contact') : ''
            const person = id ? pin.contacts.find((item) => item.id === id) : undefined
            if (person) openContactFrom(node, person)
            else togglePin(node, pin.key)
          }
          const marker = new gl.Marker({ element, anchor: 'center' }).setLngLat([pin.lon, pin.lat]).addTo(view)
          markers.push(marker)
        }
        const signature = pins.map((pin) => pin.key).join('|')
        if (pins.length && signature !== fitted) {
          fitted = signature
          const lngs = pins.map((pin) => pin.lon)
          const lats = pins.map((pin) => pin.lat)
          view.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 14 })
        }
      },
    }
  })
}

function openContactFrom(node: HTMLElement, contact: ContactSummary) {
  const opener = (node as HTMLElement & { __rolodexOpen?: (contact: ContactSummary) => void }).__rolodexOpen
  opener?.(contact)
}

function togglePin(node: HTMLElement, key: string) {
  const toggle = (node as HTMLElement & { __rolodexToggle?: (key: string) => void }).__rolodexToggle
  toggle?.(key)
}

function loadMapLibre() {
  const current = (window as unknown as { maplibregl?: MapLibre }).maplibregl
  if (current) return Promise.resolve(current)
  ensureStylesheet('maplibre-css', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css')
  return new Promise<MapLibre>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'
    script.onload = () => {
      const api = (window as unknown as { maplibregl?: MapLibre }).maplibregl
      if (api) resolve(api)
      else reject(new Error('MapLibre did not load'))
    }
    script.onerror = () => reject(new Error('MapLibre could not load'))
    document.head.appendChild(script)
  })
}

type MapLibre = {
  Map: new (options: { container: HTMLElement; style: string; center: [number, number]; zoom: number; attributionControl: boolean }) => {
    remove: () => void
    on: (event: string, handler: () => void) => void
    getZoom: () => number
    flyTo: (options: { center: [number, number]; zoom: number }) => void
    fitBounds: (bounds: [[number, number], [number, number]], options: { padding: number; maxZoom: number }) => void
  }
  Marker: new (options: { element: HTMLElement; anchor: string }) => { setLngLat: (point: [number, number]) => { addTo: (map: unknown) => { remove: () => void } } }
}

function ensurePinStyle() {
  if (document.getElementById('rolodex-pin-style')) return
  const style = document.createElement('style')
  style.id = 'rolodex-pin-style'
  style.textContent = '.rolodex-pin{background:transparent;border:none;}'
  document.head.appendChild(style)
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
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  stage: { flexDirection: 'row', borderWidth: 1, borderColor: theme.border, borderRadius: 22, overflow: 'hidden', backgroundColor: theme.surface },
  stageStacked: { flexDirection: 'column' },
  mapPane: { flex: 1.6, minWidth: 0, minHeight: 420, position: 'relative', backgroundColor: theme.raised },
  empty: { flex: 1, backgroundColor: theme.bg },
  mapSearch: { position: 'absolute', top: 14, alignSelf: 'center', width: '70%', maxWidth: 420, zIndex: 500, backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontFamily: font, fontSize: 15, color: theme.text, borderWidth: 1, borderColor: theme.border },
  finding: { position: 'absolute', left: 14, bottom: 14, zIndex: 500, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, fontFamily: font, color: theme.muted, fontSize: 13 },
  side: { width: 320, borderLeftWidth: 1, borderLeftColor: theme.border, backgroundColor: theme.surface },
  sideStacked: { width: '100%', borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: theme.border, maxHeight: 280 },
  count: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text, paddingHorizontal: 16, paddingTop: 16 },
  sideMeta: { fontFamily: font, color: theme.muted, fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
  list: { flex: 1, marginTop: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  personOn: { backgroundColor: theme.bg },
  personCopy: { flex: 1, gap: 2 },
  personName: { fontFamily: font, fontSize: 15, fontWeight: '700', color: theme.text },
  personMeta: { fontFamily: font, fontSize: 13, color: theme.muted },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.raised, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: theme.text },
})
