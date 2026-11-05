import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { api, send } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font } from '../../../src/theme'
import { Notice } from '../../../src/ui'

type PluginRow = { id: string; name: string; version: string; description: string; enabled: boolean }

export default function PluginsPage() {
  const { workspace } = useAuth()
  const router = useRouter()
  const wide = useWindowDimensions().width >= 980
  const [rows, setRows] = useState<PluginRow[]>([])
  const [tab, setTab] = useState<'discover' | 'installed'>('discover')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  function load() {
    if (!workspace) return
    api<{ plugins: PluginRow[] }>(`/api/workspaces/${workspace.id}/plugins`)
      .then((result) => setRows(result.plugins))
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace])

  const installed = rows.filter((plugin) => plugin.enabled)
  const discover = rows.filter((plugin) => !plugin.enabled)
  const source = tab === 'installed' ? installed : discover
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return source
    return source.filter((plugin) => `${plugin.name} ${plugin.description}`.toLowerCase().includes(needle))
  }, [source, query])

  function toggle(plugin: PluginRow) {
    if (!workspace) return
    setError('')
    void send<PluginRow>(`/api/workspaces/${workspace.id}/plugins/${plugin.id}`, 'PUT', { enabled: !plugin.enabled })
      .then((next) => {
        setRows((current) => current.map((item) => (item.id === next.id ? next : item)))
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('rolodex-plugins'))
      })
      .catch((caught: Error) => setError(caught.message))
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.heading}>Plugins</Text>
          <Text style={styles.lead}>Add a page of your own. A plugin can read names and keep its notes. It cannot change Rolodex.</Text>
        </View>
      </View>
      <View style={styles.toolbar}>
        <View style={styles.tabs}>
          <Tab label="Installed" count={installed.length} on={tab === 'installed'} onPress={() => setTab('installed')} />
          <Tab label="Discover" count={discover.length} on={tab === 'discover'} onPress={() => setTab('discover')} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search plugins"
          placeholderTextColor="#8d8a93"
          style={styles.search}
        />
      </View>
      {error ? <Notice text={error} /> : null}
      {!visible.length ? <Text style={styles.empty}>{tab === 'installed' ? 'No plugins added yet.' : 'No plugins left to add. Put a folder with rolodex-plugin.json in the plugins directory.'}</Text> : null}
      <View style={[styles.grid, wide && styles.gridWide]}>
        {visible.map((plugin) => (
          <View key={plugin.id} style={styles.card}>
            <View style={styles.preview}>
              <Text style={styles.mark}>{plugin.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.name}>{plugin.name}</Text>
              <Text style={styles.description} numberOfLines={3}>{plugin.description}</Text>
              <View style={styles.footer}>
                <Text style={styles.meta}>PAGE · v{plugin.version}</Text>
                {plugin.enabled ? (
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="button" onPress={() => router.push(`/plugins/${plugin.id}`)} style={styles.open}>
                      <Text style={styles.openText}>Open</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => toggle(plugin)} style={styles.installed}>
                      <Text style={styles.installedText}>Installed</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" onPress={() => toggle(plugin)} style={styles.install}>
                    <Text style={styles.installText}>Install</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

function Tab({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.tab, on && styles.tabOn]}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
      <View style={[styles.count, on && styles.countOn]}>
        <Text style={[styles.countText, on && styles.countTextOn]}>{count}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#17151c', borderRadius: 24, padding: 18, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  heading: { fontFamily: font, fontSize: 28, fontWeight: '700', color: '#f5f3f7' },
  lead: { fontFamily: font, color: '#b9b4c0', fontSize: 14, marginTop: 4, maxWidth: 560 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  tabOn: { backgroundColor: '#2a2630' },
  tabText: { fontFamily: font, color: '#b9b4c0', fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: '#ffffff' },
  count: { minWidth: 22, borderRadius: 999, backgroundColor: '#3a3542', paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  countOn: { backgroundColor: '#ff4d6d' },
  countText: { fontFamily: font, color: '#f5f3f7', fontSize: 12, fontWeight: '700' },
  countTextOn: { color: '#ffffff' },
  search: { minWidth: 220, flexGrow: 1, maxWidth: 360, borderRadius: 12, backgroundColor: '#221f27', color: '#f5f3f7', fontFamily: font, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10 },
  empty: { fontFamily: font, color: '#b9b4c0', fontSize: 14 },
  grid: { gap: 14 },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { width: '100%', maxWidth: 360, flexGrow: 1, backgroundColor: '#121016', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#2c2832' },
  preview: { height: 148, backgroundColor: '#2a1740', alignItems: 'center', justifyContent: 'center' },
  mark: { fontFamily: font, color: '#ffffff', fontSize: 42, fontWeight: '700' },
  body: { padding: 14, gap: 8 },
  name: { fontFamily: font, color: '#f5f3f7', fontSize: 18, fontWeight: '700' },
  description: { fontFamily: font, color: '#b9b4c0', fontSize: 13, minHeight: 52 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  meta: { fontFamily: font, color: '#8d8a93', fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  install: { backgroundColor: '#ff4d6d', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  installText: { fontFamily: font, color: '#ffffff', fontSize: 14, fontWeight: '700' },
  installed: { backgroundColor: '#2a2630', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  installedText: { fontFamily: font, color: '#f5f3f7', fontSize: 14, fontWeight: '700' },
  open: { paddingHorizontal: 8, paddingVertical: 8 },
  openText: { fontFamily: font, color: '#f5f3f7', fontSize: 14, fontWeight: '700' },
})
