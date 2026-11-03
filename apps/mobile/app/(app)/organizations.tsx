import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, send, type Organization, type OrgMember } from '../../src/api'
import { useAuth } from '../../src/auth'
import { IndustryField } from '../../src/fields'
import { OrgLogo } from '../../src/org-logo'
import { PersonPicker } from '../../src/people'
import { font, theme } from '../../src/theme'
import { Button, Field, Notice, Panel } from '../../src/ui'

export function OrganizationsPage() {
  const { workspace } = useAuth()
  const canWrite = workspace?.role === 'owner' || workspace?.role === 'administrator' || workspace?.role === 'editor'
  const [rows, setRows] = useState<Organization[]>([])
  const [members, setMembers] = useState<Record<string, OrgMember[]>>({})
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [website, setWebsite] = useState('')
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [person, setPerson] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  function load() {
    if (!workspace) return
    api<Organization[]>(`/api/workspaces/${workspace.id}/organizations`)
      .then(async (next) => {
        setRows(next)
        const pairs = await Promise.all(next.map(async (row) => [row.id, await api<OrgMember[]>(`/api/workspaces/${workspace.id}/organizations/${row.id}/members`)] as const))
        setMembers(Object.fromEntries(pairs))
      })
      .catch((caught: Error) => setError(caught.message))
  }

  useEffect(load, [workspace?.id])

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? rows.filter((row) => [row.name, row.industry, row.website, row.city].some((value) => value?.toLowerCase().includes(needle)))
    : rows

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Organizations</Text>
      <Text style={styles.meta}>A person can belong to more than one. Membership is separate from the company name on their card.</Text>
      {error ? <Notice text={error} /> : null}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search organizations"
        placeholderTextColor={theme.muted}
        style={styles.search}
      />
      {visible.map((row) => (
        <OrgCard
          key={row.id}
          row={row}
          members={members[row.id] ?? []}
          canWrite={canWrite}
          editing={editingId === row.id}
          workspaceId={workspace?.id}
          onEdit={() => setEditingId(row.id)}
          onClose={() => setEditingId((current) => (current === row.id ? null : current))}
          onChange={load}
          onError={setError}
        />
      ))}
      {canWrite && workspace ? (
        <Panel>
          <Field label="Name" value={name} onChangeText={setName} />
          <IndustryField value={industry} onChange={setIndustry} />
          <Field label="Website" autoCapitalize="none" value={website} onChangeText={setWebsite} placeholder="https://example.com" />
          <Button
            label="Create organization"
            disabled={!name.trim()}
            onPress={() => void send(`/api/workspaces/${workspace.id}/organizations`, 'POST', { name: name.trim(), industry: industry || null, website: website || null }).then(() => { setName(''); setIndustry(''); setWebsite(''); load() }).catch((caught: Error) => setError(caught.message))}
          />
          <Text style={styles.name}>Add a person</Text>
          <View style={styles.chips}>
            {rows.map((row) => (
              <Pressable key={row.id} onPress={() => setTarget(row.id)} style={[styles.chip, target === row.id && styles.chipOn]}>
                <Text style={[styles.chipText, target === row.id && styles.chipTextOn]}>{row.name}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Title" value={title} onChangeText={setTitle} />
          <PersonPicker workspaceId={workspace.id} selected={person ? [person] : []} onToggle={(id) => setPerson(id === person ? '' : id)} />
          <Button
            label="Add person"
            disabled={!target || !person}
            onPress={() => void send(`/api/workspaces/${workspace.id}/organizations/${target}/members`, 'POST', { contactId: person, title: title || null }).then(() => { setPerson(''); load() }).catch((caught: Error) => setError(caught.message))}
          />
        </Panel>
      ) : null}
    </View>
  )
}

function OrgCard({
  row,
  members,
  canWrite,
  editing,
  workspaceId,
  onEdit,
  onClose,
  onChange,
  onError,
}: {
  row: Organization
  members: OrgMember[]
  canWrite: boolean
  editing: boolean
  workspaceId?: string
  onEdit: () => void
  onClose: () => void
  onChange: () => void
  onError: (message: string) => void
}) {
  const router = useRouter()
  const [name, setName] = useState(row.name)
  const [industry, setIndustry] = useState(row.industry ?? '')
  const [website, setWebsite] = useState(row.website ?? '')

  useEffect(() => {
    setName(row.name)
    setIndustry(row.industry ?? '')
    setWebsite(row.website ?? '')
  }, [row.name, row.industry, row.website, editing])

  return (
    <Panel>
      <View style={styles.identity}>
        <OrgLogo uri={row.logoUrl} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{row.name}</Text>
          <Text style={styles.meta}>{[row.industry, row.city, row.email].filter(Boolean).join(' · ') || 'No details'}</Text>
          {row.website ? <Text style={styles.link} onPress={() => void Linking.openURL(row.website!)}>{row.website}</Text> : null}
        </View>
        {canWrite && !editing ? <Button label="Edit" tone="ghost" onPress={onEdit} /> : null}
      </View>
      {members.map((member) => (
        <View key={member.contactId} style={styles.row}>
          <Pressable onPress={() => router.push(`/contacts/${member.contactId}`)}>
            <Text style={styles.link}>{member.displayName}{member.title ? ` · ${member.title}` : ''}</Text>
          </Pressable>
          {canWrite ? (
            <Button label="Remove" tone="ghost" onPress={() => void send(`/api/workspaces/${workspaceId}/organizations/${row.id}/members/${member.contactId}`, 'DELETE').then(onChange)} />
          ) : null}
        </View>
      ))}
      {editing ? (
        <View style={styles.form}>
          <Field label="Name" value={name} onChangeText={setName} />
          <IndustryField value={industry} onChange={setIndustry} />
          <Field label="Website" autoCapitalize="none" value={website} onChangeText={setWebsite} placeholder="https://example.com" />
          <Button
            label="Save"
            disabled={!name.trim()}
            onPress={() => void send(`/api/workspaces/${workspaceId}/organizations/${row.id}`, 'PATCH', { name: name.trim(), industry: industry || null, website: website || null }).then(() => { onClose(); onChange() }).catch((caught: Error) => onError(caught.message))}
          />
          <Button label="Delete" tone="danger" onPress={() => void send(`/api/workspaces/${workspaceId}/organizations/${row.id}`, 'DELETE').then(() => { onClose(); onChange() })} />
        </View>
      ) : null}
    </Panel>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  title: { fontFamily: font, fontSize: 32, fontWeight: '700', color: theme.text },
  search: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 14, fontFamily: font, fontSize: 15, color: theme.text },
  name: { fontFamily: font, fontSize: 18, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted },
  link: { fontFamily: font, color: theme.text, fontSize: 15 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  form: { gap: 10, marginTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: theme.text, borderColor: theme.text },
  chipText: { fontFamily: font, color: theme.text, fontSize: 13 },
  chipTextOn: { color: theme.on },
})

export default function OrganizationsRoute() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings?tab=organizations')
  }, [router])
  return null
}
