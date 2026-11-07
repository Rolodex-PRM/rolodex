import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api } from './api'
import { PluginFrame } from './plugin-frame'
import { font, theme } from './theme'
import { Panel } from './ui'

type PluginLink = { id: string; name: string; enabled: boolean; permissions?: string[] }

export function PluginProfileSections({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const [rows, setRows] = useState<PluginLink[]>([])

  useEffect(() => {
    api<{ plugins: PluginLink[] }>(`/api/workspaces/${workspaceId}/plugins`)
      .then((result) => setRows(result.plugins.filter((plugin) => plugin.enabled && plugin.permissions?.includes('profile:section'))))
      .catch(() => setRows([]))
  }, [workspaceId])

  if (!rows.length) return null
  return (
    <View style={styles.list}>
      {rows.map((plugin) => (
        <Panel key={plugin.id}>
          <Text style={styles.title}>{plugin.name}</Text>
          <PluginFrame pluginId={plugin.id} contactId={contactId} height={420} />
        </Panel>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  title: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
})
