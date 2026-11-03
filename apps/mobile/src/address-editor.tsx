import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, type MapSettings, type Place } from './api'
import { useAccent } from './accent'
import { MapCanvas } from './map-canvas'
import { alamo } from './map-themes'
import { font, theme } from './theme'
import { Field } from './ui'

type AddressValue = { street: string; city: string; region: string; postalCode: string; country: string }

const emptyMap: MapSettings = { engine: 'leaflet', templateId: 'osm', tileUrl: '', cartoKey: '', mapboxToken: '', googleKey: '' }

export function AddressEditor({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId?: string
  value: AddressValue
  onChange: (value: AddressValue) => void
}) {
  const { accent, onAccent } = useAccent()
  const [map, setMap] = useState<MapSettings>(emptyMap)
  const [point, setPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [results, setResults] = useState<Place[]>([])
  const [error, setError] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [wide, setWide] = useState(true)
  const placed = useRef(false)
  const suppressSearch = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    if (!workspaceId) return
    api<MapSettings>(`/api/workspaces/${workspaceId}/map`).then(setMap).catch(() => setMap(emptyMap))
  }, [workspaceId])

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const update = () => setWide(window.innerWidth >= 960)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (placed.current) {
      placed.current = false
      return
    }
    const query = [value.street, value.city, value.region, value.postalCode, value.country].filter(Boolean).join(', ')
    if (!workspaceId || query.length < 2) {
      setPoint(null)
      return
    }
    const handle = setTimeout(() => {
      api<Place[]>(`/api/workspaces/${workspaceId}/places?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          const hit = rows.find((row) => row.lat != null && row.lon != null)
          if (hit?.lat != null && hit.lon != null) setPoint({ lat: hit.lat, lon: hit.lon })
        })
        .catch(() => undefined)
    }, 700)
    return () => clearTimeout(handle)
  }, [workspaceId, value.street, value.city, value.region, value.postalCode, value.country])

  useEffect(() => {
    const query = value.street.trim()
    if (suppressSearch.current) {
      suppressSearch.current = false
      setResults([])
      return
    }
    if (!workspaceId || query.length < 2) {
      setResults([])
      return
    }
    const handle = setTimeout(() => {
      api<Place[]>(`/api/workspaces/${workspaceId}/places?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          setResults(rows)
          setError('')
        })
        .catch((caught: Error) => {
          setResults([])
          setError(caught.message)
        })
    }, 150)
    return () => clearTimeout(handle)
  }, [workspaceId, value.street])

  function apply(place: Place) {
    placed.current = true
    suppressSearch.current = true
    setResults([])
    onChange({
      street: place.street || valueRef.current.street,
      city: place.city || valueRef.current.city,
      region: place.region || valueRef.current.region,
      postalCode: place.postalCode || valueRef.current.postalCode,
      country: place.country || valueRef.current.country,
    })
    if (place.lat != null && place.lon != null) setPoint({ lat: place.lat, lon: place.lon })
  }

  async function choose(place: Place) {
    if (place.provider === 'google' && place.lat == null && workspaceId) {
      const detail = await api<Place>(`/api/workspaces/${workspaceId}/places/details?id=${encodeURIComponent(place.id)}`)
      apply(detail)
      return
    }
    apply(place)
  }

  function moved(lat: number, lon: number) {
    setPoint({ lat, lon })
    if (!workspaceId) return
    placed.current = true
    suppressSearch.current = true
    api<Place>(`/api/workspaces/${workspaceId}/places/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`)
      .then((place) => {
        placed.current = true
        suppressSearch.current = true
        onChange({
          street: place.street,
          city: place.city,
          region: place.region,
          postalCode: place.postalCode,
          country: place.country || valueRef.current.country,
        })
      })
      .catch((caught: Error) => setError(caught.message))
  }

  const shown = point ?? alamo

  return (
    <View style={[styles.card, wide && styles.cardWide]}>
      <View style={styles.fields}>
        <Text style={styles.heading}>Enter your address:</Text>
        <Text style={styles.label}>Address</Text>
        <TextInput
          value={value.street}
          onChangeText={(street) => onChange({ ...value, street })}
          placeholder="355 Buena Vista Avenue East"
          placeholderTextColor={theme.muted}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {results.length ? (
          <View style={styles.menu}>
            {results.map((place) => {
              const lines = placeLines(place)
              return (
                <Pressable key={`${place.provider}-${place.id}`} onPress={() => void choose(place)} style={styles.option}>
                  <View style={styles.optionCopy}>
                    <Text style={styles.optionTitle}>{lines.title}</Text>
                    {lines.subtitle ? <Text style={styles.optionSub}>{lines.subtitle}</Text> : null}
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{lines.badge}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        ) : null}
        <Field label="City" value={value.city} onChangeText={(city) => onChange({ ...value, city })} />
        <View style={styles.row}>
          <Field style={styles.grow} label="State" value={value.region} onChangeText={(region) => onChange({ ...value, region })} />
          <Field style={styles.grow} label="Zip Code" value={value.postalCode} onChangeText={(postalCode) => onChange({ ...value, postalCode })} />
        </View>
        <Field label="Country" value={value.country} onChangeText={(country) => onChange({ ...value, country })} />
      </View>
      <View style={styles.mapPane}>
        <MapCanvas settings={map} point={shown} adjusting={adjusting} onMove={moved} />
        <Pressable onPress={() => setAdjusting((current) => !current)} style={[styles.adjust, { backgroundColor: adjusting ? theme.text : accent }]}>
          <Text style={[styles.adjustText, { color: adjusting ? '#fff' : onAccent }]}>{adjusting ? 'Done' : 'Adjust pin'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

function placeLines(place: Place) {
  const title = (place.street || place.label.split(',')[0] || place.label).trim()
  const subtitle = [place.city, place.country].filter(Boolean).join(', ')
  const badge = place.provider === 'google' ? 'Google' : place.provider === 'mapbox' ? 'Mapbox' : 'OpenStreetMap'
  return { title, subtitle, badge }
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, overflow: 'hidden' },
  cardWide: { flexDirection: 'row' },
  fields: { flex: 1, gap: 12, padding: 18, minWidth: 260 },
  heading: { fontFamily: font, fontSize: 18, fontWeight: '700', color: theme.text },
  label: { color: theme.muted, fontSize: 11, fontFamily: font, letterSpacing: 0.8, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: font, fontSize: 15, color: theme.text },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  menu: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
  optionSub: { fontFamily: font, color: theme.muted, fontSize: 14 },
  badge: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: font, color: theme.muted, fontSize: 12 },
  error: { color: theme.danger, fontFamily: font, fontSize: 13 },
  mapPane: { flex: 1, minHeight: 320, minWidth: 260, position: 'relative', backgroundColor: theme.raised },
  adjust: { position: 'absolute', right: 12, bottom: 36, zIndex: 500, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  adjustText: { fontFamily: font, fontSize: 14, fontWeight: '700' },
})
