import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, type ContactSummary } from '../../src/api'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button, Field, Panel } from '../../src/ui'

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function Search() {
  const { workspace } = useAuth()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [organization, setOrganization] = useState('')
  const [relationship, setRelationship] = useState('')
  const [tag, setTag] = useState('')
  const [birthdayMonth, setBirthdayMonth] = useState(0)
  const [quietDays, setQuietDays] = useState('')
  const [rows, setRows] = useState<ContactSummary[]>([])
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  async function run() {
    if (!workspace) return
    const params = new URLSearchParams({ limit: '100' })
    if (q.trim()) params.set('q', q.trim())
    if (city.trim()) params.set('city', city.trim())
    if (organization.trim()) params.set('organization', organization.trim())
    if (relationship.trim()) params.set('relationship', relationship.trim())
    if (tag.trim()) params.set('tag', tag.trim())
    if (birthdayMonth) params.set('birthdayMonth', String(birthdayMonth))
    if (quietDays.trim()) params.set('quietDays', quietDays.trim())
    try {
      const result = await api<{ contacts: ContactSummary[] }>(`/api/workspaces/${workspace.id}/contacts?${params}`)
      setRows(result.contacts)
      setError('')
      setSearched(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed')
    }
  }

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Search</Text>
      <Panel>
        <Field label="Words" value={q} onChangeText={setQ} placeholder="Name, note, phone, birthday" />
        <Field label="City" value={city} onChangeText={setCity} />
        <Field label="Organization" value={organization} onChangeText={setOrganization} />
        <Field label="Relationship" value={relationship} onChangeText={setRelationship} placeholder="coworker, parent, spouse" />
        <Field label="Tag" value={tag} onChangeText={setTag} />
        <Text style={styles.meta}>Birthday month</Text>
        <View style={styles.months}>
          {months.map((month, index) => (
            <Pressable key={month} onPress={() => setBirthdayMonth(birthdayMonth === index + 1 ? 0 : index + 1)} style={[styles.month, birthdayMonth === index + 1 && styles.monthOn]}>
              <Text style={styles.monthText}>{month.slice(0, 3)}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Quiet for days" keyboardType="number-pad" value={quietDays} onChangeText={setQuietDays} placeholder="90" />
        <Button label="Search" onPress={() => void run()} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Panel>
      {searched ? <Text style={styles.meta}>{rows.length} {rows.length === 1 ? 'person' : 'people'}</Text> : null}
      {rows.map((contact) => (
        <Pressable key={contact.id} onPress={() => router.push(`/contacts/${contact.id}?workspace=${contact.workspaceId}`)} style={styles.row}>
          <Text style={styles.name}>{contact.displayName}</Text>
          <Text style={styles.meta}>{[contact.organizationName, contact.city].filter(Boolean).join(' · ')}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  error: { fontFamily: font, color: theme.danger },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  month: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  monthOn: { backgroundColor: theme.accentMuted },
  monthText: { fontFamily: font, color: theme.text, fontSize: 13 },
  row: { gap: 2, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  name: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '600' },
})
