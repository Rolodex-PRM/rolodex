import { createElement, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { api, type MapSettings } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { MapCanvas } from '../../../src/map-canvas'
import { alamo, savedSecret, themesFor, type MapEngine, type MapTheme } from '../../../src/map-themes'
import { font, theme } from '../../../src/theme'
import { Button, Field, Notice } from '../../../src/ui'

const emptyMap: MapSettings = { engine: 'leaflet', templateId: 'osm', tileUrl: '', cartoKey: '', mapboxToken: '', googleKey: '' }

const engines: { id: MapEngine; title: string; detail: string; experimental?: boolean }[] = [
  { id: 'leaflet', title: 'Leaflet', detail: 'Classic 2D, any raster tiles' },
  { id: 'mapbox', title: 'Mapbox GL', detail: 'Vector tiles, 3D buildings & terrain', experimental: true },
  { id: 'maplibre', title: 'MapLibre GL', detail: 'OpenFreeMap vector tiles, no token' },
]

export default function MapPage() {
  const { workspace } = useAuth()
  const [draft, setDraft] = useState<MapSettings>(emptyMap)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const stored = useRef({ cartoKey: '', mapboxToken: '', googleKey: '' })

  useEffect(() => {
    if (!workspace) return
    api<MapSettings>(`/api/workspaces/${workspace.id}/map`)
      .then(showSaved)
      .catch((caught: Error) => setError(caught.message))
  }, [workspace])

  function showSaved(settings: MapSettings) {
    stored.current = {
      cartoKey: settings.cartoKey === savedSecret ? stored.current.cartoKey : settings.cartoKey,
      mapboxToken: settings.mapboxToken === savedSecret ? stored.current.mapboxToken : settings.mapboxToken,
      googleKey: settings.googleKey === savedSecret ? stored.current.googleKey : settings.googleKey,
    }
    setDraft({
      ...settings,
      cartoKey: settings.cartoKey ? savedSecret : '',
      mapboxToken: settings.mapboxToken ? savedSecret : '',
      googleKey: settings.googleKey ? savedSecret : '',
    })
  }

  function liveSecret(shown: string, kept: string) {
    if (shown !== savedSecret) return shown
    return kept && kept !== savedSecret ? kept : savedSecret
  }

  function chooseEngine(engine: MapEngine) {
    const next = themesFor(engine)[0]
    setDraft((current) => ({ ...current, engine, templateId: next?.id ?? '', tileUrl: next?.url ?? '' }))
  }

  function chooseTheme(next: MapTheme) {
    setDraft((current) => ({ ...current, templateId: next.id, tileUrl: next.url }))
  }

  async function save() {
    if (!workspace) return
    setError('')
    setNotice('')
    try {
      const saved = await api<MapSettings>(`/api/workspaces/${workspace.id}/map`, {
        method: 'PUT',
        body: JSON.stringify({
          ...draft,
          cartoKey: liveSecret(draft.cartoKey, stored.current.cartoKey),
          mapboxToken: liveSecret(draft.mapboxToken, stored.current.mapboxToken),
          googleKey: liveSecret(draft.googleKey, stored.current.googleKey),
        }),
      })
      showSaved(saved)
      setNotice('Map settings saved')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the map settings')
    }
  }

  const themes = themesFor(draft.engine)
  const urlLabel = draft.engine === 'leaflet' ? 'Tile URL' : draft.engine === 'mapbox' ? 'Mapbox style' : 'Style URL'
  const urlHint = draft.engine === 'leaflet'
    ? 'Leave empty for OpenStreetMap (default).'
    : draft.engine === 'mapbox'
      ? 'A Mapbox style such as mapbox/streets-v12. The access token is added when the map loads.'
      : 'Leave empty for OpenFreeMap Liberty.'

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Map</Text>
      <Text style={styles.section}>Map Provider</Text>
      <Text style={styles.meta}>Affects the address map and the preview below. Address search always checks OpenStreetMap and Google together.</Text>
      <View style={styles.engines}>
        {engines.map((engine) => {
          const selected = draft.engine === engine.id
          return (
            <Pressable key={engine.id} onPress={() => chooseEngine(engine.id)} style={[styles.engine, selected && styles.engineOn]}>
              <View style={styles.engineTitleRow}>
                <Text style={styles.engineTitle}>{engine.title}</Text>
                {engine.experimental ? <Text style={styles.experimental}>Experimental</Text> : null}
              </View>
              <Text style={styles.engineDetail}>{engine.detail}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text style={styles.kicker}>Map template</Text>
      <ThemeSelect themes={themes} value={draft.templateId} onChange={chooseTheme} />
      <Field
        label={urlLabel}
        autoCapitalize="none"
        value={draft.tileUrl}
        onChangeText={(tileUrl) => setDraft((current) => ({ ...current, tileUrl }))}
      />
      <Text style={styles.hint}>{urlHint}</Text>
      {draft.engine === 'leaflet' ? (
        <>
          <SecretField label="Carto API key" value={draft.cartoKey} onChangeText={(cartoKey) => setDraft((current) => ({ ...current, cartoKey }))} />
          <Text style={styles.hint}>CARTO basemaps need this key on every tile. Free, no account, from carto.com/basemaps/apikey.</Text>
        </>
      ) : null}
      {draft.engine === 'mapbox' ? (
        <SecretField label="Mapbox access token" value={draft.mapboxToken} onChangeText={(mapboxToken) => setDraft((current) => ({ ...current, mapboxToken }))} />
      ) : null}
      <SecretField label="Google Maps API key" value={draft.googleKey} onChangeText={(googleKey) => setDraft((current) => ({ ...current, googleKey }))} />
      <Text style={styles.hint}>Used for address suggestions alongside OpenStreetMap. The map tiles do not use this key.</Text>
      <View style={styles.preview}>
        <MapCanvas
          settings={{
            ...draft,
            cartoKey: liveSecret(draft.cartoKey, stored.current.cartoKey),
            mapboxToken: liveSecret(draft.mapboxToken, stored.current.mapboxToken),
          }}
          point={alamo}
          height={220}
        />
      </View>
      <View style={styles.saveRow}>
        <Button label="Save Map" onPress={() => void save()} />
      </View>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.meta}>{notice}</Text> : null}
    </View>
  )
}

function SecretField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <Field
      label={label}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      value={value}
      onChangeText={(next) => {
        if (value !== savedSecret) {
          onChangeText(next)
          return
        }
        const typed = next.replaceAll(savedSecret, '')
        onChangeText(/^\*+$/.test(typed) ? '' : typed)
      }}
      onFocus={() => {
        if (value !== savedSecret || Platform.OS !== 'web') return
        requestAnimationFrame(() => {
          const node = document.activeElement
          if (node instanceof HTMLInputElement) node.select()
        })
      }}
    />
  )
}

function ThemeSelect({ themes, value, onChange }: { themes: MapTheme[]; value: string; onChange: (theme: MapTheme) => void }) {
  if (Platform.OS === 'web') {
    return createElement(
      'select',
      {
        value,
        onChange: (event: { target: { value: string } }) => {
          const next = themes.find((item) => item.id === event.target.value)
          if (next) onChange(next)
        },
        style: {
          width: '100%',
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          padding: '12px 14px',
          fontFamily: font,
          fontSize: 15,
          color: theme.text,
          backgroundColor: theme.surface,
          marginBottom: 12,
        },
      },
      themes.map((item) => createElement('option', { key: item.id, value: item.id }, item.name)),
    )
  }
  return (
    <View style={styles.themeList}>
      {themes.map((item) => (
        <Pressable key={item.id} onPress={() => onChange(item)} style={[styles.themeChip, value === item.id && styles.engineOn]}>
          <Text style={styles.engineDetail}>{item.name}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 8 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  section: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text, marginTop: 8 },
  meta: { fontFamily: font, color: theme.muted, marginBottom: 8 },
  engines: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  engine: { flexGrow: 1, flexBasis: 180, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 14, gap: 6 },
  engineOn: { borderColor: theme.text },
  engineTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  engineTitle: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  experimental: { fontFamily: font, fontSize: 12, fontWeight: '700', color: '#b45309' },
  engineDetail: { fontFamily: font, color: theme.muted, fontSize: 13 },
  kicker: { color: theme.muted, fontSize: 11, fontFamily: font, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 8 },
  hint: { fontFamily: font, color: theme.muted, fontSize: 13, marginTop: -4, marginBottom: 4 },
  themeList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  themeChip: { borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  preview: { borderRadius: 16, overflow: 'hidden', marginTop: 8 },
  saveRow: { alignItems: 'flex-end', marginTop: 8 },
})
