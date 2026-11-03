import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api } from './api'
import { AuthImage } from './immich-photos'
import { font, theme } from './theme'

type Memory = { activityId: string; attachmentId: string; contactId: string; contactName: string; year: number; label: string }

export function Memories({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [rows, setRows] = useState<Memory[]>([])

  useEffect(() => {
    api<Memory[]>(`/api/workspaces/${workspaceId}/memories`).then(setRows).catch(() => setRows([]))
  }, [workspaceId])

  if (!rows.length) return null
  return (
    <View style={styles.block}>
      <Text style={styles.title}>On this day</Text>
      <View style={styles.row}>
        {rows.map((memory) => (
          <Pressable key={`${memory.activityId}-${memory.attachmentId}`} onPress={() => router.push(`/contacts/${memory.contactId}`)} style={styles.card}>
            <AuthImage path={`/api/workspaces/${workspaceId}/files/${memory.attachmentId}`} size={96} radius={12} />
            <Text style={styles.meta} numberOfLines={2}>{memory.year} · {memory.contactName}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  title: { fontFamily: font, fontSize: 13, color: theme.muted, letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  card: { width: 96, gap: 4 },
  meta: { fontFamily: font, color: theme.text, fontSize: 12 },
})
