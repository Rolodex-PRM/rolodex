import { createElement, useEffect, useState, type ReactNode } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, send, type Activity, type ImmichGallery, type ImmichPersonHit } from './api'
import { font, theme } from './theme'
import { Button, Notice, Panel } from './ui'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

function authHeaders() {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem('rolodex.session')
  const parsed = raw ? (JSON.parse(raw) as { token?: string }) : null
  return parsed?.token ? { Authorization: `Bearer ${parsed.token}` } : undefined
}

export function AuthImage({ path, size, radius = 12, fallback = null }: { path: string; size: number; radius?: number; fallback?: ReactNode }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let url = ''
    let stop = false
    fetch(`${API_URL}${path}`, { headers: authHeaders(), credentials: 'include' })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || stop) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => setSrc(''))
    return () => {
      stop = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])
  if (!src || Platform.OS !== 'web') return fallback ?? <View style={[styles.thumb, { width: size, height: size, borderRadius: radius }]} />
  return createElement('img', { src, alt: '', style: { width: size, height: size, objectFit: 'cover', borderRadius: radius, background: theme.bg } })
}

export function ImmichPhotos({
  workspaceId,
  contactId,
  canWrite,
  canChangePhoto = false,
  onAttachments,
  onPhoto,
}: {
  workspaceId: string
  contactId: string
  canWrite: boolean
  canChangePhoto?: boolean
  onAttachments?: (rows: ImmichGallery['attachments']) => void
  onPhoto?: () => void
}) {
  const [gallery, setGallery] = useState<ImmichGallery | null>(null)
  const [events, setEvents] = useState<Activity[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ImmichPersonHit[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')

  function load() {
    api<ImmichGallery>(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich`)
      .then((next) => {
        setGallery(next)
        onAttachments?.(next.enabled ? next.attachments : [])
      })
      .catch((caught: Error) => setError(caught.message))
    api<Activity[]>(`/api/workspaces/${workspaceId}/activities?contactId=${contactId}`).then(setEvents).catch(() => setEvents([]))
  }

  useEffect(load, [workspaceId, contactId])

  useEffect(() => {
    if (!gallery?.connected || query.trim().length < 2) {
      setHits([])
      return
    }
    const handle = setTimeout(() => {
      api<ImmichPersonHit[]>(`/api/workspaces/${workspaceId}/immich/people?q=${encodeURIComponent(query.trim())}`).then(setHits).catch(() => setHits([]))
    }, 200)
    return () => clearTimeout(handle)
  }, [query, gallery?.connected, workspaceId])

  async function link(personId: string) {
    setError('')
    try {
      await send(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich`, 'POST', { personId })
      setQuery('')
      setHits([])
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not link that person')
    }
  }

  if (!gallery?.enabled) return null
  if (!gallery.connected) {
    return (
      <Panel>
        <Text style={styles.section}>Photos</Text>
        <Text style={styles.meta}>Connect Immich in Admin to link recognized people and their photos.</Text>
      </Panel>
    )
  }

  const selectedAsset = gallery.links.flatMap((link) => link.assets).find((asset) => asset.id === selected)

  return (
    <Panel>
      <Text style={styles.section}>Photos</Text>
      <Text style={styles.meta}>Photos stay in Immich. Linking a person does not copy the library, and it does not change the Immich face.</Text>
      {error ? <Notice text={error} /> : null}
      {gallery.suggestions.map((person) => (
        <View key={person.personId} style={styles.row}>
          <AuthImage path={`/api/workspaces/${workspaceId}/immich/people/${person.personId}/thumbnail`} size={48} />
          <View style={styles.grow}>
            <Text style={styles.name}>{person.name}</Text>
            <Text style={styles.meta}>Suggested from {person.instanceName}. Confirm before linking.</Text>
          </View>
          {canWrite ? <Button label="Link" onPress={() => void link(person.personId)} /> : null}
        </View>
      ))}
      {gallery.links.map((link) => (
        <View key={link.identityId} style={styles.block}>
          <View style={styles.row}>
            <AuthImage path={`/api/workspaces/${workspaceId}/immich/people/${link.personId}/thumbnail`} size={64} />
            <View style={styles.grow}>
              <Text style={styles.name}>{link.name}</Text>
              <Text style={styles.meta}>
                {link.missing ? 'This person is no longer in Immich. The contact is unchanged.' : `${link.photoCount} photos · ${link.videoCount} videos · ${link.instanceName}`}
              </Text>
              {link.error ? <Text style={styles.meta}>{link.error}</Text> : null}
            </View>
          </View>
          <View style={styles.actions}>
            <Button label="Open in Immich" tone="ghost" onPress={() => void Linking.openURL(link.personUrl)} />
            {canChangePhoto ? <Button label="Use face as photo" tone="ghost" onPress={() => void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich/photo`, 'POST', { personId: link.personId }).then(() => onPhoto?.()).catch((caught: Error) => setError(caught.message))} /> : null}
            {canWrite ? <Button label="Unlink" tone="ghost" onPress={() => void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich/${link.identityId}`, 'DELETE').then(load).catch((caught: Error) => setError(caught.message))} /> : null}
          </View>
          <View style={styles.grid}>
            {link.assets.map((asset) => {
              const attached = gallery.attachments.some((item) => item.assetId === asset.id)
              return (
                <Pressable key={asset.id} onPress={() => setSelected(asset.id === selected ? '' : asset.id)}>
                  <AuthImage path={`/api/workspaces/${workspaceId}/immich/assets/${asset.id}/thumbnail`} size={96} />
                  {attached ? <Text style={styles.badge}>On an interaction</Text> : null}
                </Pressable>
              )
            })}
          </View>
        </View>
      ))}
      {selectedAsset && canWrite ? (
        <View style={styles.block}>
          <Text style={styles.meta}>{canChangePhoto ? 'Use this photo as the contact photo, or attach it to an interaction. Immich itself stays the same.' : 'Attach this photo to an interaction. Immich itself stays the same.'}</Text>
          {canChangePhoto ? <Button label="Use as contact photo" tone="ghost" onPress={() => void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich/photo`, 'POST', { assetId: selectedAsset.id }).then(() => onPhoto?.()).catch((caught: Error) => setError(caught.message))} /> : null}
          {events.slice(0, 6).map((event) => (
            <Button
              key={event.id}
              label={`Attach to ${event.type} · ${event.occurredAt.slice(0, 10)}`}
              tone="ghost"
              onPress={() => void send(`/api/workspaces/${workspaceId}/activities/${event.id}/immich`, 'POST', { assetId: selectedAsset.id }).then(load).catch((caught: Error) => setError(caught.message))}
            />
          ))}
          <Button label="Open original" tone="ghost" onPress={() => void Linking.openURL(selectedAsset.photoUrl)} />
        </View>
      ) : null}
      {canWrite ? (
        <View style={styles.block}>
          <Text style={styles.meta}>Find another Immich person</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search people" placeholderTextColor={theme.muted} style={styles.input} />
          {hits.map((person) => (
            <View key={person.id} style={styles.row}>
              <Text style={styles.name}>{person.name}</Text>
              <Text style={styles.meta}>{person.linkedContact ? `Linked to ${person.linkedContact.displayName}` : person.instanceName}</Text>
              {!person.linkedContact ? <Button label="Link" tone="ghost" onPress={() => void link(person.id)} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Panel>
  )
}

const styles = StyleSheet.create({
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  name: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  grow: { flex: 1, gap: 2 },
  block: { gap: 8, marginTop: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: { backgroundColor: theme.bg, borderRadius: 12 },
  badge: { fontFamily: font, fontSize: 11, color: theme.muted },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: font, color: theme.text, backgroundColor: theme.surface },
})
