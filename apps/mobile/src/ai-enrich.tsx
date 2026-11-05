import { useEffect, useState, type ReactNode } from 'react'
import { Linking, Pressable, StyleSheet, Text, View, type TextStyle } from 'react-native'
import { enrichmentColors, useAccent } from './accent'
import { api, send } from './api'
import { useColorScheme } from './color-scheme'
import { font, theme } from './theme'
import { Button, Notice } from './ui'

export type Suggestion = {
  id: string
  contactId: string
  displayName: string
  field: string
  label: string
  value: string
  sourceUrl: string
  excerpt: string
  status: string
}

export function useApprovedFields(workspaceId: string, contactId: string) {
  const [rows, setRows] = useState<Suggestion[]>([])
  useEffect(() => {
    if (!workspaceId || !contactId) return
    api<Suggestion[]>(`/api/workspaces/${workspaceId}/ai/suggestions?contactId=${contactId}&status=approved`).then(setRows).catch(() => setRows([]))
  }, [workspaceId, contactId])
  return (field: string, value?: string | null) => rows.some((row) => row.field === field && row.value === (value || '').trim())
}

export function EnrichedText({ on, style, children }: { on: boolean; style?: TextStyle; children: ReactNode }) {
  const { accent } = useAccent()
  const { scheme } = useColorScheme()
  if (!on) return <Text style={style}>{children}</Text>
  const colors = enrichmentColors(accent, scheme)
  return <Text accessibilityLabel={`AI enriched. ${typeof children === 'string' ? children : ''}`} style={[style, styles.enriched, colors]}>{children}</Text>
}

export function contactIdFromPath(path: string) {
  const id = path.match(/^\/contacts\/([^/]+)/)?.[1]
  if (!id || id === 'new') return undefined
  return id
}

export function AiMenu({ workspaceId, contactId, canWrite, canManage, onOpen }: { workspaceId: string; contactId?: string; canWrite: boolean; canManage: boolean; onOpen: (href: string) => void }) {
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function enhance() {
    if (!contactId) return
    setBusy(true)
    setNotice('')
    try {
      const result = await send<{ kept: number; discarded: number }>(`/api/workspaces/${workspaceId}/contacts/${contactId}/ai/suggest`, 'POST')
      setNotice(result.kept ? `${result.kept} suggestion${result.kept === 1 ? '' : 's'} ready for review.` : 'Nothing on a public page could be verified.')
      setVersion((current) => current + 1)
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not enhance this contact')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <Text style={styles.title}>AI</Text>
      <Text style={styles.meta}>Suggestions stay here until you approve them. A field is saved only after it is found on the source page and you accept it.</Text>
      {contactId && canWrite ? <Button label={busy ? 'Enhancing' : 'Enhance this contact'} onPress={() => void enhance()} disabled={busy} /> : null}
      {notice ? <Notice text={notice} /> : null}
      <SuggestionList key={`${contactId ?? 'all'}-${version}`} workspaceId={workspaceId} contactId={contactId} onOpen={onOpen} />
      {canManage ? <Button label="AI settings" tone="ghost" onPress={() => onOpen('/admin/addons')} /> : null}
    </View>
  )
}

export function AiEnrich({ workspaceId, contactId, canWrite, onApplied }: { workspaceId: string; contactId: string; canWrite: boolean; onApplied: () => void }) {
  const [enabled, setEnabled] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    api<{ enabled: boolean }>(`/api/workspaces/${workspaceId}/ai`).then((row) => setEnabled(row.enabled)).catch(() => setEnabled(false))
  }, [workspaceId])

  async function lookUp() {
    setBusy(true)
    setNotice('')
    try {
      const result = await send<{ kept: number; discarded: number }>(`/api/workspaces/${workspaceId}/contacts/${contactId}/ai/suggest`, 'POST')
      setNotice(result.kept ? `${result.kept} suggestion${result.kept === 1 ? '' : 's'} ready for review.` : 'Nothing on a public page could be verified.')
      setVersion((current) => current + 1)
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Could not look up fields')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.section}>AI enrichment</Text>
      <Text style={styles.meta}>The assistant may only suggest a field when the exact text appears on a public page. You approve each one. The history keeps the decision.</Text>
      {enabled && canWrite ? <Button label={busy ? 'Looking up' : 'Look up fields'} tone="ghost" onPress={() => void lookUp()} /> : null}
      {!enabled ? <Text style={styles.meta}>An administrator turns this on under Admin, Add-ons, AI.</Text> : null}
      {notice ? <Notice text={notice} /> : null}
      <SuggestionList key={version} workspaceId={workspaceId} contactId={contactId} onOpen={() => undefined} onChange={onApplied} />
    </View>
  )
}

function SuggestionList({ workspaceId, contactId, onOpen, onChange }: { workspaceId: string; contactId?: string; onOpen: (href: string) => void; onChange?: () => void }) {
  const [rows, setRows] = useState<Suggestion[]>([])
  const [error, setError] = useState('')

  function load() {
    const query = contactId ? `?contactId=${contactId}&status=pending` : ''
    api<Suggestion[]>(`/api/workspaces/${workspaceId}/ai/suggestions${query}`).then(setRows).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspaceId, contactId])

  async function decide(id: string, action: 'approve' | 'reject') {
    setError('')
    try {
      await send(`/api/workspaces/${workspaceId}/ai/suggestions/${id}/${action}`, 'POST')
      load()
      onChange?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the suggestion')
    }
  }

  if (error) return <Notice text={error} />
  if (!rows.length) return <Text style={styles.meta}>No suggestions waiting.</Text>
  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <Pressable accessibilityLabel={`Open ${row.displayName}`} onPress={() => onOpen(`/contacts/${row.contactId}`)}>
            <Text style={styles.name}>{row.displayName}</Text>
          </Pressable>
          <Text style={styles.field}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
          <Text style={styles.meta}>{row.excerpt}</Text>
          <Text style={styles.link} onPress={() => void Linking.openURL(row.sourceUrl)}>{row.sourceUrl}</Text>
          <View style={styles.actions}>
            <Button label="Approve" onPress={() => void decide(row.id, 'approve')} />
            <Button label="Dismiss" tone="ghost" onPress={() => void decide(row.id, 'reject')} />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  title: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text, marginBottom: 6 },
  section: { fontFamily: font, fontSize: 13, color: theme.muted, letterSpacing: 0.4, marginBottom: 8 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13, marginBottom: 8 },
  panel: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 16 },
  list: { gap: 10 },
  card: { gap: 4, paddingVertical: 6 },
  name: { fontFamily: font, color: theme.accent, fontSize: 15, fontWeight: '700' },
  field: { fontFamily: font, color: theme.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  value: { fontFamily: font, color: theme.text, fontSize: 15, fontWeight: '700' },
  link: { fontFamily: font, color: theme.accent, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  enriched: { alignSelf: 'flex-start', borderRadius: 6, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2, fontWeight: '700' },
})
