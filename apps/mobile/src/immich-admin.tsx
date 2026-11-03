import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, send, type ImmichInstance } from './api'
import { savedSecret } from './map-themes'
import { font, theme } from './theme'
import { Button, Field, Notice } from './ui'

const empty = { id: '', name: '', internalUrl: '', externalUrl: '', apiKey: '' }

export function ImmichAdmin({ workspaceId, embedded = false }: { workspaceId: string; embedded?: boolean }) {
  const [rows, setRows] = useState<ImmichInstance[]>([])
  const [draft, setDraft] = useState(empty)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  function load() {
    api<ImmichInstance[]>(`/api/workspaces/${workspaceId}/immich`).then(setRows).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspaceId])

  function choose(row: ImmichInstance) {
    setDraft({ id: row.id, name: row.name, internalUrl: row.internalUrl, externalUrl: row.externalUrl, apiKey: row.apiKey })
    setNotice('')
    setError(row.error ?? '')
  }

  async function test() {
    setError('')
    setNotice('')
    try {
      const result = await send<{ version: string; user: string }>(`/api/workspaces/${workspaceId}/immich/test`, 'POST', {
        instanceId: draft.id || undefined,
        internalUrl: draft.internalUrl,
        apiKey: draft.apiKey,
      })
      setNotice(`Connected${result.version ? ` · Immich ${result.version}` : ''}${result.user ? ` · ${result.user}` : ''}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Immich could not be reached')
    }
  }

  async function save() {
    setError('')
    setNotice('')
    try {
      const saved = await send<ImmichInstance>(`/api/workspaces/${workspaceId}/immich${draft.id ? `/${draft.id}` : ''}`, draft.id ? 'PATCH' : 'POST', {
        name: draft.name,
        internalUrl: draft.internalUrl,
        externalUrl: draft.externalUrl,
        apiKey: draft.apiKey,
      })
      setDraft({ ...draft, id: saved.id, apiKey: saved.apiKey })
      setNotice(saved.error ? saved.error : 'Immich connection saved')
      setError(saved.status === 'error' ? saved.error ?? 'Immich could not be reached' : '')
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save Immich')
    }
  }

  return (
    <View style={embedded ? styles.embedded : styles.card}>
      {embedded ? null : <Text style={styles.heading}>Immich</Text>}
      <Text style={styles.meta}>Immich keeps the photos. Rolodex stores the link between a recognized person and a contact, and the API key stays on this server. Anyone who can open this workspace can see the linked photos.</Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Notice text={notice} /> : null}
      {rows.map((row) => (
        <Pressable key={row.id} onPress={() => choose(row)} style={styles.pair}>
          <View>
            <Text style={styles.engineTitle}>{row.name}</Text>
            <Text style={styles.hint}>{row.status}{row.lastSyncedAt ? ` · synced ${row.lastSyncedAt.slice(0, 16).replace('T', ' ')}` : ''}</Text>
          </View>
          <Pressable
            onPress={() => {
              setError('')
              void send(`/api/workspaces/${workspaceId}/immich/${row.id}/sync`, 'POST')
                .then((result) => {
                  const synced = result as { people: number }
                  setNotice(`Synced ${synced.people} people`)
                  load()
                })
                .catch((caught: Error) => setError(caught.message))
            }}
          >
            <Text style={styles.hint}>Sync</Text>
          </Pressable>
        </Pressable>
      ))}
      <Field label="Name" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Home photos" />
      <Field label="Internal URL" autoCapitalize="none" value={draft.internalUrl} onChangeText={(internalUrl) => setDraft((current) => ({ ...current, internalUrl }))} placeholder="http://immich:2283" />
      <Text style={styles.hint}>The address this server uses to reach Immich.</Text>
      <Field label="External URL" autoCapitalize="none" value={draft.externalUrl} onChangeText={(externalUrl) => setDraft((current) => ({ ...current, externalUrl }))} placeholder="https://photos.example.com" />
      <Text style={styles.hint}>The address you open in a browser. Leave empty to use the internal URL.</Text>
      <Field
        label="API key"
        autoCapitalize="none"
        secureTextEntry
        value={draft.apiKey}
        onChangeText={(apiKey) => setDraft((current) => ({ ...current, apiKey: current.apiKey === savedSecret ? apiKey.replaceAll('*', '') : apiKey }))}
        placeholder="Paste an Immich API key"
      />
      <View style={styles.actions}>
        <Button label="Test connection" tone="ghost" disabled={!draft.internalUrl.trim()} onPress={() => void test()} />
        <Button label={draft.id ? 'Save connection' : 'Add connection'} disabled={!draft.name.trim() || !draft.internalUrl.trim()} onPress={() => void save()} />
        {draft.id ? (
          <Button
            label="Remove"
            tone="ghost"
            onPress={() => {
              void send(`/api/workspaces/${workspaceId}/immich/${draft.id}`, 'DELETE').then(() => {
                setDraft(empty)
                setNotice('Immich connection removed')
                load()
              }).catch((caught: Error) => setError(caught.message))
            }}
          />
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 8 },
  embedded: { gap: 8 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, marginBottom: 8 },
  pair: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  engineTitle: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  hint: { fontFamily: font, color: theme.muted, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 8 },
})
