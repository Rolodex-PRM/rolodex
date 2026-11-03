import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, send } from '../../src/api'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button, Notice, Panel } from '../../src/ui'

type Group = { reason: 'email' | 'phone' | 'name'; contacts: { id: string; displayName: string }[] }

const reasons = { email: 'Same email', phone: 'Same phone', name: 'Same name' }

export function DuplicatesPage() {
  const { workspace } = useAuth()
  const router = useRouter()
  const [groups, setGroups] = useState<Group[]>([])
  const [error, setError] = useState('')
  const canWrite = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'

  function load() {
    if (!workspace) return
    api<Group[]>(`/api/workspaces/${workspace.id}/duplicates`).then(setGroups).catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace])

  async function merge(keepId: string, duplicateIds: string[]) {
    if (!workspace) return
    setError('')
    try {
      for (const duplicateId of duplicateIds) await send(`/api/workspaces/${workspace.id}/contacts/${keepId}/merge`, 'POST', { duplicateId })
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not merge')
    }
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Duplicates</Text>
      <Text style={styles.meta}>People who share an email, a phone number, or a full name. Merging keeps one record and moves the history onto it.</Text>
      {error ? <Notice text={error} /> : null}
      {!groups.length ? <Text style={styles.meta}>No likely duplicates.</Text> : null}
      {groups.map((group) => (
        <Panel key={group.contacts.map((contact) => contact.id).join()}>
          <Text style={styles.reason}>{reasons[group.reason]}</Text>
          {group.contacts.map((contact) => (
            <View key={contact.id} style={styles.row}>
              <Pressable onPress={() => router.push(`/contacts/${contact.id}`)}>
                <Text style={styles.name}>{contact.displayName}</Text>
              </Pressable>
              {canWrite ? <Button label="Keep this one" tone="ghost" onPress={() => void merge(contact.id, group.contacts.filter((other) => other.id !== contact.id).map((other) => other.id))} /> : null}
            </View>
          ))}
        </Panel>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted },
  reason: { fontFamily: font, color: theme.text, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  name: { fontFamily: font, color: theme.accent, fontSize: 16 },
})

export default function DuplicatesRoute() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=duplicates')
  }, [router])
  return null
}
