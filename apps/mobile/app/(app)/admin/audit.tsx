import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Notice } from '../../../src/ui'

type Row = { id: string; action: string; entityType: string; actorName: string; createdAt: string; detail: string | null }

export default function AuditPage() {
  const { workspace } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!workspace) return
    api<Row[]>(`/api/workspaces/${workspace.id}/audit`).then(setRows).catch((caught: Error) => setError(caught.message))
  }, [workspace])

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Audit trail</Text>
      <Text style={styles.meta}>Recent changes in this workspace.</Text>
      {error ? <Notice text={error} /> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.row}>
          <Text style={styles.action}>{describe(row.action)}</Text>
          <Text style={styles.meta}>{row.actorName} · {new Date(row.createdAt).toLocaleString()}</Text>
          {row.detail ? <Text style={styles.meta}>{row.detail}</Text> : null}
        </View>
      ))}
      {rows.length === 0 && !error ? <Text style={styles.meta}>No recorded changes yet.</Text> : null}
    </View>
  )
}

function describe(action: string) {
  const [entity, verb] = action.split('.')
  const entities: Record<string, string> = { contact: 'Person', note: 'Note', task: 'Task', event: 'Event', member: 'User' }
  const verbs: Record<string, string> = { create: 'created', update: 'updated', delete: 'deleted', restore: 'restored' }
  const name = entities[entity || ''] || entity || action
  const done = verbs[verb || '']
  return done ? `${name} ${done}` : action
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 12 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  row: { gap: 2, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border },
  action: { fontFamily: font, color: theme.text, fontSize: 15, fontWeight: '600' },
})
