import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { api, send } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'
import { Button, Field, Notice, Panel } from './ui'

type Row = { id: string; displayName: string; deletedAt: string | null }

export function TrashPanel() {
  const { workspace } = useAuth()
  const canManage = workspace?.role === 'owner' || workspace?.role === 'administrator'
  const [rows, setRows] = useState<Row[]>([])
  const [days, setDays] = useState('30')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    if (!workspace) return
    api<{ retentionDays: number; contacts: Row[] }>(`/api/workspaces/${workspace.id}/trash`)
      .then((result) => {
        setRows(result.contacts)
        setDays(String(result.retentionDays))
      })
      .catch((caught: Error) => setError(caught.message))
  }, [workspace])

  useEffect(() => { load() }, [load])
  if (!workspace) return null

  return (
    <View style={styles.page}>
      <Panel>
        <Text style={styles.name}>Trash</Text>
        <Text style={styles.meta}>Deleted people stay here until the trash is cleared or the retention period ends. Restoring a person puts them back on the phone at the next check-in.</Text>
        {error ? <Notice text={error} /> : null}
        {notice ? <Text style={styles.meta}>{notice}</Text> : null}
        <Field label="Days to keep deleted people" keyboardType="number-pad" value={days} onChangeText={setDays} />
        {canManage ? (
          <Button
            label="Save retention"
            tone="ghost"
            onPress={() => {
              const retentionDays = Number(days)
              if (!Number.isInteger(retentionDays) || retentionDays < 1) {
                setError('Enter a number of days')
                return
              }
              void send(`/api/workspaces/${workspace.id}/trash`, 'PUT', { retentionDays })
                .then(() => { setNotice(`Deleted people are kept for ${retentionDays} days`); load() })
                .catch((caught: Error) => setError(caught.message))
            }}
          />
        ) : null}
        <Button
          label="Empty trash"
          tone="danger"
          onPress={() => void send<{ removed: number }>(`/api/workspaces/${workspace.id}/trash`, 'DELETE').then((result) => { setNotice(`Removed ${result.removed}`); load() }).catch((caught: Error) => setError(caught.message))}
        />
      </Panel>
      {rows.map((person) => (
        <Panel key={person.id}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{person.displayName}</Text>
              <Text style={styles.meta}>{person.deletedAt ? `Deleted ${new Date(person.deletedAt).toLocaleString()}` : ''}</Text>
            </View>
            <Button
              label="Restore"
              onPress={() => void send(`/api/workspaces/${workspace.id}/trash/${person.id}/restore`, 'POST').then(() => { setNotice('Restored'); load() }).catch((caught: Error) => setError(caught.message))}
            />
          </View>
        </Panel>
      ))}
      {rows.length === 0 ? <Text style={styles.meta}>Trash is empty.</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 14 },
  name: { fontFamily: font, fontSize: 16, fontWeight: '600', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
})
