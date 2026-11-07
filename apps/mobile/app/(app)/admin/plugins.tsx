import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, send } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Field, Notice } from '../../../src/ui'

type PluginSetting = { key: string; label: string; type: 'text' | 'boolean' }
type PluginRow = { id: string; name: string; version: string; description: string; enabled: boolean; settings: PluginSetting[]; permissions?: string[]; values: Record<string, string>; present?: boolean; listed?: boolean }

export default function PluginsPage() {
  const { workspace } = useAuth()
  const router = useRouter()
  const [rows, setRows] = useState<PluginRow[]>([])
  const [tab, setTab] = useState<'discover' | 'installed'>('discover')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
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
    <View style={styles.card}>
      <Text style={styles.heading}>Plugins</Text>
      <Text style={styles.meta}>Add a page of your own. A plugin can read names and keep its notes. It cannot change Rolodex. Discover also lists plugins from the registry once their folder is on this server.</Text>
      <View style={styles.toolbar}>
        <View style={styles.tabs}>
          <Tab label="Installed" count={installed.length} on={tab === 'installed'} onPress={() => setTab('installed')} />
          <Tab label="Discover" count={discover.length} on={tab === 'discover'} onPress={() => setTab('discover')} />
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search plugins"
          placeholderTextColor={theme.muted}
          style={styles.search}
        />
      </View>
      {error ? <Notice text={error} /> : null}
      {!visible.length ? <Text style={styles.meta}>{tab === 'installed' ? 'No plugins added yet.' : 'No plugins left to add. Put a folder with rolodex-plugin.json in the plugins directory.'}</Text> : null}
      {visible.map((plugin) => {
        const expanded = plugin.enabled && open[plugin.id] !== false
        return (
          <View key={plugin.id} style={styles.block}>
            <View style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.name}>{plugin.name}</Text>
                <Text style={styles.meta}>{plugin.description}</Text>
                <Text style={styles.version}>Page · v{plugin.version}{plugin.listed ? ' · Registry' : ''}</Text>
                {plugin.permissions?.length ? <Text style={styles.meta}>{plugin.permissions.join(' · ')}</Text> : null}
                {plugin.present === false ? <Text style={styles.meta}>Listed in the registry. Put its folder in plugins/ on this server to install it.</Text> : null}
              </View>
              <View style={styles.actions}>
                {plugin.enabled ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push(`/plugins/${plugin.id}`)} style={styles.toggle}>
                    <Text style={styles.toggleText}>Open</Text>
                  </Pressable>
                ) : null}
                {plugin.present !== false ? (
                  <Pressable accessibilityRole="button" onPress={() => toggle(plugin)} style={[styles.toggle, !plugin.enabled && styles.install]}>
                    <Text style={[styles.toggleText, !plugin.enabled && styles.installText]}>{plugin.enabled ? 'Remove' : 'Install'}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {plugin.enabled ? (
              <View style={styles.accordion}>
                <Pressable
                  accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${plugin.name} settings`}
                  onPress={() => setOpen((current) => ({ ...current, [plugin.id]: !expanded }))}
                  style={styles.accordionHead}
                >
                  <Text style={styles.name}>Settings</Text>
                  <Text style={styles.chevron}>{expanded ? 'Hide' : 'Show'}</Text>
                </Pressable>
                {expanded ? (
                  <PluginSettings
                    plugin={plugin}
                    onSave={(next) => {
                      if (!workspace) return
                      setError('')
                      void send<PluginRow>(`/api/workspaces/${workspace.id}/plugins/${plugin.id}/settings`, 'PUT', { values: next })
                        .then((saved) => setRows((current) => current.map((item) => (item.id === saved.id ? saved : item))))
                        .catch((caught: Error) => setError(caught.message))
                    }}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function PluginSettings({ plugin, onSave }: { plugin: PluginRow; onSave: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState(plugin.values)
  useEffect(() => setValues(plugin.values), [plugin.values])
  if (!plugin.settings.length) return <Text style={styles.meta}>This plugin has no settings.</Text>
  return (
    <View style={styles.fields}>
      {plugin.settings.map((setting) =>
        setting.type === 'boolean' ? (
          <View key={setting.key} style={styles.switchRow}>
            <Text style={styles.name}>{setting.label}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const next = { ...values, [setting.key]: values[setting.key] === 'true' ? 'false' : 'true' }
                setValues(next)
                onSave(next)
              }}
              style={[styles.toggle, values[setting.key] === 'true' && styles.install]}
            >
              <Text style={[styles.toggleText, values[setting.key] === 'true' && styles.installText]}>{values[setting.key] === 'true' ? 'On' : 'Off'}</Text>
            </Pressable>
          </View>
        ) : (
          <Field
            key={setting.key}
            label={setting.label}
            value={values[setting.key] ?? ''}
            onChangeText={(text) => setValues((current) => ({ ...current, [setting.key]: text }))}
            onBlur={(event) => {
              const text = event.nativeEvent.text
              if (text === (plugin.values[setting.key] ?? '')) return
              onSave({ ...values, [setting.key]: text })
            }}
          />
        ),
      )}
    </View>
  )
}

function Tab({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.tab, on && styles.tabOn]}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
      <Text style={[styles.tabCount, on && styles.tabTextOn]}>{count}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 12 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  tabOn: { backgroundColor: theme.text, borderColor: theme.text },
  tabText: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: theme.on },
  tabCount: { fontFamily: font, color: theme.muted, fontSize: 13, fontWeight: '700' },
  search: { minWidth: 220, flexGrow: 1, maxWidth: 360, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, fontFamily: font, fontSize: 15, color: theme.text },
  block: { borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 14 },
  accordion: { borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.raised, padding: 14, gap: 10 },
  accordionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chevron: { fontFamily: font, color: theme.muted, fontSize: 14, fontWeight: '700' },
  fields: { gap: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, gap: 4 },
  name: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  version: { fontFamily: font, color: theme.muted, fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggle: { borderWidth: 1, borderColor: theme.text, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  install: { backgroundColor: theme.text },
  toggleText: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '700' },
  installText: { color: theme.on },
})
