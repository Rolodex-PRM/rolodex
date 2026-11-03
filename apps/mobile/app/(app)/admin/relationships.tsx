import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, send, type RelationshipType } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Button, Field, Notice } from '../../../src/ui'

export default function RelationshipsPage() {
  const { workspace } = useAuth()
  const [rows, setRows] = useState<RelationshipType[]>([])
  const [label, setLabel] = useState('')
  const [reciprocal, setReciprocal] = useState('')
  const [error, setError] = useState('')

  function load() {
    if (!workspace) return
    api<RelationshipType[]>(`/api/workspaces/${workspace.id}/relationship-types`).then(setRows).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace])

  if (!workspace) return null

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Relationships</Text>
      <Text style={styles.meta}>Name both sides. If Ada is a grandparent, the other person is a grandchild. Use the same word twice when both people share it, such as friend and friend.</Text>
      {error ? <Notice text={error} /> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.pair}>
          <Text style={styles.engineTitle}>{row.label.toLowerCase() === row.reciprocalLabel.toLowerCase() ? row.label : `${row.label} / ${row.reciprocalLabel}`}</Text>
          <Pressable
            onPress={() => {
              setError('')
              void send(`/api/workspaces/${workspace.id}/relationship-types/${row.id}`, 'DELETE').then(load).catch((caught: Error) => setError(caught.message))
            }}
          >
            <Text style={styles.hint}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Field label="This side" value={label} onChangeText={setLabel} placeholder="grandparent" />
      <Field label="Other side" value={reciprocal} onChangeText={setReciprocal} placeholder="grandchild" />
      <View style={styles.saveRow}>
        <Button
          label="Add relationship"
          disabled={!label.trim() || !reciprocal.trim()}
          onPress={() => {
            setError('')
            void send(`/api/workspaces/${workspace.id}/relationship-types`, 'POST', { label: label.trim(), reciprocalLabel: reciprocal.trim() })
              .then(() => {
                setLabel('')
                setReciprocal('')
                load()
              })
              .catch((caught: Error) => setError(caught.message))
          }}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 8 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, marginBottom: 8 },
  engineTitle: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  hint: { fontFamily: font, color: theme.muted, fontSize: 13 },
  saveRow: { alignItems: 'flex-end', marginTop: 8 },
  pair: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
})
