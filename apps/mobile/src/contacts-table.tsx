import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import type { ContactSummary } from './api'
import { AuthImage } from './immich-photos'
import { font, theme } from './theme'

type Key = 'displayName' | 'organizationName' | 'title' | 'primaryEmail' | 'primaryPhone' | 'city' | 'tags'

const columns: { key: Key; label: string }[] = [
  { key: 'displayName', label: 'Name' },
  { key: 'organizationName', label: 'Organization' },
  { key: 'title', label: 'Title' },
  { key: 'primaryEmail', label: 'Email' },
  { key: 'primaryPhone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'tags', label: 'Tags' },
]

const emptyFilters: Record<Key, string> = {
  displayName: '',
  organizationName: '',
  title: '',
  primaryEmail: '',
  primaryPhone: '',
  city: '',
  tags: '',
}

function cell(contact: ContactSummary, key: Key) {
  if (key === 'tags') return contact.tags.map((tag) => tag.name).join(', ')
  return contact[key] ?? ''
}

export function ContactsTable({ contacts, onOpen }: { contacts: ContactSummary[]; onOpen: (contact: ContactSummary) => void }) {
  const [sortKey, setSortKey] = useState<Key>('displayName')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState(emptyFilters)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = contacts.filter((contact) => {
      if (needle && !columns.some((column) => cell(contact, column.key).toLowerCase().includes(needle))) return false
      return columns.every((column) => {
        const filter = filters[column.key].trim().toLowerCase()
        return !filter || cell(contact, column.key).toLowerCase().includes(filter)
      })
    })
    rows.sort((a, b) => {
      const left = cell(a, sortKey).toLowerCase()
      const right = cell(b, sortKey).toLowerCase()
      if (left === right) return 0
      const order = left < right ? -1 : 1
      return direction === 'asc' ? order : -order
    })
    return rows
  }, [contacts, direction, filters, query, sortKey])

  function sort(key: Key) {
    if (sortKey === key) setDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDirection('asc')
    }
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search this table"
        placeholderTextColor={theme.muted}
        style={styles.search}
      />
      <View style={styles.table}>
        <View style={styles.head}>
          {columns.map((column) => (
            <View key={column.key} style={[styles.col, column.key === 'displayName' && styles.nameCol]}>
              <Pressable onPress={() => sort(column.key)}>
                <Text style={styles.headText}>
                  {column.label}
                  {sortKey === column.key ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
                </Text>
              </Pressable>
              <TextInput
                value={filters[column.key]}
                onChangeText={(value) => setFilters((current) => ({ ...current, [column.key]: value }))}
                placeholder="Filter"
                placeholderTextColor={theme.muted}
                style={styles.filter}
              />
            </View>
          ))}
        </View>
        {shown.map((contact) => (
          <Pressable key={contact.id} onPress={() => onOpen(contact)} style={styles.row}>
            {columns.map((column) => (
              <View key={column.key} style={[styles.col, column.key === 'displayName' && styles.nameCol]}>
                {column.key === 'displayName' ? (
                  <View style={styles.person}>
                    {contact.hasPhoto ? (
                      <AuthImage
                        path={`/api/workspaces/${contact.workspaceId}/contacts/${contact.id}/photo`}
                        size={28}
                        radius={14}
                        fallback={<View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>}
                      />
                    ) : (
                      <View style={styles.avatar}><Text style={styles.avatarText}>{contact.displayName.slice(0, 1).toUpperCase()}</Text></View>
                    )}
                    <Text style={styles.name}>{contact.displayName}</Text>
                  </View>
                ) : (
                  <Text style={styles.cell}>{cell(contact, column.key) || '—'}</Text>
                )}
              </View>
            ))}
          </Pressable>
        ))}
      </View>
      <Text style={styles.meta}>{shown.length} {shown.length === 1 ? 'person' : 'people'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  search: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, fontFamily: font, fontSize: 14, color: theme.text },
  table: { borderWidth: 1, borderColor: theme.border, borderRadius: 18, overflow: 'hidden', backgroundColor: theme.surface },
  head: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.border },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  col: { flex: 1, minWidth: 90, gap: 6 },
  nameCol: { flex: 1.4, minWidth: 140 },
  headText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: theme.text },
  filter: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontFamily: font, fontSize: 12, color: theme.text, backgroundColor: theme.surface },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: theme.text },
  name: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text, flexShrink: 1 },
  cell: { fontFamily: font, fontSize: 13, color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
})
