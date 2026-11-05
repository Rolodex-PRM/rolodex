import { usePathname, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { api } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'

type PluginLink = { id: string; name: string; enabled: boolean }

export function PluginBar() {
  const { workspace } = useAuth()
  const path = usePathname()
  const router = useRouter()
  const [rows, setRows] = useState<PluginLink[]>([])

  useEffect(() => {
    if (!workspace) return
    let stop = false
    const load = () => {
      api<{ plugins: PluginLink[] }>(`/api/workspaces/${workspace.id}/plugins`)
        .then((result) => {
          if (!stop) setRows(result.plugins.filter((plugin) => plugin.enabled))
        })
        .catch(() => {
          if (!stop) setRows([])
        })
    }
    load()
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => { stop = true }
    window.addEventListener('rolodex-plugins', load)
    return () => {
      stop = true
      window.removeEventListener('rolodex-plugins', load)
    }
  }, [workspace, path])

  if (!rows.length) return null

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.row}>
      {rows.map((plugin) => {
        const active = path === `/plugins/${plugin.id}`
        return (
          <Pressable key={plugin.id} accessibilityRole="button" onPress={() => router.push(`/plugins/${plugin.id}`)} style={[styles.link, active && styles.linkOn]}>
            <Text style={[styles.label, active && styles.labelOn]}>{plugin.name}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.border, maxHeight: 52 },
  row: { alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  link: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  linkOn: { backgroundColor: theme.text, borderColor: theme.text },
  label: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '600' },
  labelOn: { color: theme.on },
})
