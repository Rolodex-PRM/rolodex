import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, send, type Addon } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { AiAdmin } from '../../../src/ai-admin'
import { ImmichAdmin } from '../../../src/immich-admin'
import { McpAdmin } from '../../../src/mcp-admin'
import { font, theme } from '../../../src/theme'
import { Notice } from '../../../src/ui'

export default function AddonsPage() {
  const { workspace } = useAuth()
  const [rows, setRows] = useState<Addon[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')

  function load() {
    if (!workspace) return
    api<Addon[]>(`/api/workspaces/${workspace.id}/addons`).then(setRows).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace])

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Add-ons</Text>
      <Text style={styles.meta}>Add-ons stay off until you enable them. Turning one off hides its settings and leaves any saved connection in place.</Text>
      {error ? <Notice text={error} /> : null}
      {rows.map((addon) => {
        const expanded = addon.enabled && open[addon.id] !== false
        return (
          <View key={addon.id} style={styles.block}>
            <View style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.name}>{addon.name}</Text>
                <Text style={styles.meta}>{addon.description}</Text>
                <Text style={styles.state}>{addon.enabled ? 'On' : 'Off'}</Text>
              </View>
              <Pressable
                onPress={() => {
                  if (!workspace) return
                  setError('')
                  void send<Addon>(`/api/workspaces/${workspace.id}/addons/${addon.id}`, 'PUT', { enabled: !addon.enabled })
                    .then((next) => setRows((current) => current.map((item) => (item.id === next.id ? next : item))))
                    .catch((caught: Error) => setError(caught.message))
                }}
                style={[styles.toggle, addon.enabled && styles.toggleOn]}
              >
                <Text style={[styles.toggleText, addon.enabled && styles.toggleTextOn]}>{addon.enabled ? 'Disable' : 'Enable'}</Text>
              </Pressable>
            </View>
            {addon.enabled ? (
              <View style={styles.accordion}>
                <Pressable
                  accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${addon.name} settings`}
                  onPress={() => setOpen((current) => ({ ...current, [addon.id]: !expanded }))}
                  style={styles.accordionHead}
                >
                  <Text style={styles.name}>Settings</Text>
                  <Text style={styles.chevron}>{expanded ? 'Hide' : 'Show'}</Text>
                </Pressable>
                {expanded && addon.id === 'immich' && workspace ? <ImmichAdmin workspaceId={workspace.id} embedded /> : null}
                {expanded && addon.id === 'ai' && workspace ? <AiAdmin workspaceId={workspace.id} /> : null}
                {expanded && addon.id === 'mcp' ? <McpAdmin /> : null}
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 12 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  block: { borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14 },
  copy: { flex: 1, gap: 4 },
  name: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  state: { fontFamily: font, fontSize: 13, color: theme.text, fontWeight: '700' },
  toggle: { borderWidth: 1, borderColor: theme.text, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  toggleOn: { backgroundColor: theme.text },
  toggleText: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '700' },
  toggleTextOn: { color: theme.on },
  accordion: { borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.raised, padding: 14, gap: 10 },
  accordionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chevron: { fontFamily: font, color: theme.muted, fontSize: 14, fontWeight: '700' },
})
