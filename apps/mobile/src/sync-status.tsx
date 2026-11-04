import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'

type Status = {
  lastCheckedIn: string | null
  pendingCount: number
  pending: { id: string; displayName: string; updatedAt: string }[]
}

export function SyncStatus() {
  const { workspace } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    if (!workspace) return
    api<Status>(`/api/workspaces/${workspace.id}/sync-status`).then(setStatus).catch(() => setStatus(null))
  }, [workspace])

  if (!status) return null
  const when = status.lastCheckedIn ? new Date(status.lastCheckedIn).toLocaleString() : null
  return (
    <View style={styles.box}>
      <Text style={styles.meta}>{when ? `Last phone check-in ${when}.` : 'The phone has not checked in yet.'}</Text>
      <Text style={styles.meta}>
        {status.pendingCount === 0
          ? 'The phone has the latest people from this account.'
          : `${status.pendingCount} ${status.pendingCount === 1 ? 'person has' : 'people have'} changed since that check-in. The phone picks them up the next time it refreshes.`}
      </Text>
      {status.pending.map((person) => (
        <Text key={person.id} style={styles.name}>{person.displayName}</Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  name: { fontFamily: font, color: theme.text, fontSize: 14 },
})
