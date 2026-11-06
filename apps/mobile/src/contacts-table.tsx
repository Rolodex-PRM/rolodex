import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
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

type Filters = Omit<Record<Key, string>, 'tags'> & { tags: string[] }

const emptyFilters: Filters = {
  displayName: '',
  organizationName: '',
  title: '',
  primaryEmail: '',
  primaryPhone: '',
  city: '',
  tags: [],
}

function cell(contact: ContactSummary, key: Key) {
  if (key === 'tags') return contact.tags.map((tag) => tag.name).join(', ')
  return contact[key] ?? ''
}

export function ContactsTable({ 
  contacts, 
  onOpen, 
  bulkActionMode = false, 
  selectedIds = new Set(), 
  onToggleSelect 
}: { 
  contacts: ContactSummary[]
  onOpen: (contact: ContactSummary) => void
  bulkActionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}) {
  const [sortKey, setSortKey] = useState<Key>('displayName')
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState(emptyFilters)
  const [query, setQuery] = useState('')
  const [tagsDropdownOpen, setTagsDropdownOpen] = useState(false)

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    contacts.forEach((contact) => {
      contact.tags.forEach((tag) => tagSet.add(tag.name))
    })
    return Array.from(tagSet).sort()
  }, [contacts])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = contacts.filter((contact) => {
      if (needle && !columns.some((column) => cell(contact, column.key).toLowerCase().includes(needle))) return false
      return columns.every((column) => {
        if (column.key === 'tags') {
          if (filters.tags.length === 0) return true
          return filters.tags.some((filterTag) => contact.tags.some((tag) => tag.name === filterTag))
        }
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

  function toggleTag(tag: string) {
    setFilters((current) => {
      const tags = current.tags.includes(tag)
        ? current.tags.filter((t) => t !== tag)
        : [...current.tags, tag]
      return { ...current, tags }
    })
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
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
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
                {column.key === 'tags' ? (
                  <View>
                    <Pressable
                      onPress={() => setTagsDropdownOpen(!tagsDropdownOpen)}
                      style={styles.filter}
                    >
                      <Text style={styles.filterPlaceholder}>
                        {filters.tags.length === 0 ? 'Select tags' : `${filters.tags.length} selected`}
                      </Text>
                    </Pressable>
                    {tagsDropdownOpen ? (
                      <View style={styles.dropdown}>
                        {allTags.map((tag) => (
                          <Pressable
                            key={tag}
                            onPress={() => toggleTag(tag)}
                            style={styles.dropdownItem}
                          >
                            <View style={[styles.checkbox, filters.tags.includes(tag) && styles.checkboxChecked]}>
                              {filters.tags.includes(tag) ? <Text style={styles.checkmark}>✓</Text> : null}
                            </View>
                            <Text style={styles.dropdownText}>{tag}</Text>
                          </Pressable>
                        ))}
                        {allTags.length === 0 ? (
                          <Text style={styles.dropdownEmpty}>No tags available</Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <TextInput
                    value={filters[column.key]}
                    onChangeText={(value) => setFilters((current) => ({ ...current, [column.key]: value }))}
                    placeholder="Filter"
                    placeholderTextColor={theme.muted}
                    style={styles.filter}
                  />
                )}
              </View>
            ))}
          </View>
          {shown.map((contact) => (
            <Pressable 
              key={contact.id} 
              onPress={() => {
                if (bulkActionMode && onToggleSelect) {
                  onToggleSelect(contact.id)
                } else {
                  onOpen(contact)
                }
              }} 
              style={[styles.row, bulkActionMode && selectedIds.has(contact.id) && styles.rowSelected]}
            >
              {bulkActionMode ? (
                <View style={styles.col}>
                  <View style={[styles.checkbox, selectedIds.has(contact.id) && styles.checkboxChecked]}>
                    {selectedIds.has(contact.id) ? <Text style={styles.checkmark}>✓</Text> : null}
                  </View>
                </View>
              ) : null}
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
      </ScrollView>
      <Text style={styles.meta}>{shown.length} {shown.length === 1 ? 'person' : 'people'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  search: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, fontFamily: font, fontSize: 14, color: theme.text },
  tableScroll: { borderWidth: 1, borderColor: theme.border, borderRadius: 18, backgroundColor: theme.surface },
  table: { overflow: 'hidden', minWidth: '100%' },
  head: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: theme.bg, borderBottomWidth: 1, borderBottomColor: theme.border },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  rowSelected: { backgroundColor: theme.accentMuted },
  col: { flex: 1, minWidth: 90, gap: 6 },
  nameCol: { flex: 1.4, minWidth: 140 },
  headText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: theme.text },
  filter: { borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontFamily: font, fontSize: 12, color: theme.text, backgroundColor: theme.surface },
  filterPlaceholder: { fontFamily: font, fontSize: 12, color: theme.muted },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, maxHeight: 200, zIndex: 1000, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border },
  dropdownText: { fontFamily: font, fontSize: 12, color: theme.text, flex: 1 },
  dropdownEmpty: { fontFamily: font, fontSize: 12, color: theme.muted, padding: 10, textAlign: 'center' },
  checkbox: { width: 16, height: 16, borderWidth: 1, borderColor: theme.border, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  checkboxChecked: { backgroundColor: theme.text, borderColor: theme.text },
  checkmark: { fontFamily: font, fontSize: 10, color: theme.on, fontWeight: '700' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font, fontSize: 12, fontWeight: '700', color: theme.text },
  name: { fontFamily: font, fontSize: 14, fontWeight: '700', color: theme.text, flexShrink: 1 },
  cell: { fontFamily: font, fontSize: 13, color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
})
