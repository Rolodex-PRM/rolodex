import { Link, usePathname } from 'expo-router'
import { useEffect, useState } from 'react'
import { Platform, ScrollView, StyleSheet } from 'react-native'
import { api } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'

type PluginLink = { id: string; name: string; enabled: boolean }

export function PluginBar() {
  const { workspace } = useAuth()
  const path = usePathname()
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
        const href = `/plugins/${plugin.id}`
        const active = path === href || path.startsWith(`${href}/`)
        return (
          <Link key={plugin.id} href={href} style={[styles.link, active && styles.linkActive]}>
            {plugin.name}
          </Link>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  row: { alignItems: 'center', gap: 4, paddingHorizontal: 22, paddingVertical: 8 },
  link: { color: theme.muted, fontFamily: font, fontSize: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  linkActive: { backgroundColor: theme.text, color: theme.on },
})
