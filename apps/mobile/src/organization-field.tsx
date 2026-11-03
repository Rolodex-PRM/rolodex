import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, send, type Organization } from './api'
import { useAuth } from './auth'
import { OrgLogo } from './org-logo'
import { font, theme } from './theme'

function score(name: string, query: string) {
  const target = name.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return 1
  if (target === q) return 100
  if (target.startsWith(q)) return 80
  if (target.includes(q)) return 60
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((word) => target.includes(word))) return 50
  let index = 0
  for (const char of target) {
    if (char === q[index]) index += 1
    if (index === q.length) return 30
  }
  return 0
}

export function OrganizationField({
  value,
  onChange,
  onError,
}: {
  value: string
  onChange: (value: string) => void
  onError?: (message: string) => void
}) {
  const { workspace } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  function load() {
    if (!workspace) return
    api<Organization[]>(`/api/workspaces/${workspace.id}/organizations`).then(setOrgs).catch(() => setOrgs([]))
  }

  useEffect(load, [workspace?.id])

  const query = value.trim()
  const ranked = orgs
    .map((org) => ({ org, score: score(org.name, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.org.name.localeCompare(right.org.name))
    .slice(0, 8)
  const exact = orgs.some((org) => org.name.toLowerCase() === query.toLowerCase())
  const showAdd = query.length > 0 && !exact

  async function create() {
    if (!workspace || !query || adding) return
    setAdding(true)
    try {
      const created = await send<Organization>(`/api/workspaces/${workspace.id}/organizations`, 'POST', { name: query })
      setOrgs((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
      onChange(created.name)
      setOpen(false)
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : 'Could not add the organization')
    } finally {
      setAdding(false)
    }
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Organization</Text>
      <TextInput
        value={value}
        onChangeText={(text) => {
          onChange(text)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Company"
        placeholderTextColor={theme.muted}
        style={styles.input}
      />
      {open && (ranked.length || showAdd) ? (
        <View style={styles.menu}>
          {ranked.map(({ org }) => (
            <Pressable key={org.id} onPress={() => { onChange(org.name); setOpen(false) }} style={styles.row}>
              <OrgMark org={org} />
              <Text style={styles.name} numberOfLines={1}>{org.name}</Text>
              {org.industry ? <Text style={styles.pill} numberOfLines={1}>{org.industry}</Text> : null}
            </Pressable>
          ))}
          {showAdd ? (
            <Pressable onPress={() => void create()} style={styles.row}>
              <Text style={styles.add}>{adding ? 'Adding…' : `+ Add New Organization: ${query}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function OrgMark({ org }: { org: Organization }) {
  if (org.logoUrl) return <OrgLogo uri={org.logoUrl} size={28} />
  return (
    <View style={styles.mark}>
      <Text style={styles.markText}>{org.name.slice(0, 1).toUpperCase()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: theme.muted, fontSize: 11, fontFamily: font, letterSpacing: 0.8, textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.text,
    fontFamily: font,
  },
  menu: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  name: { flex: 1, fontFamily: font, fontSize: 15, color: theme.text },
  pill: { maxWidth: 180, fontFamily: font, fontSize: 12, color: theme.text, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  add: { fontFamily: font, fontSize: 15, color: theme.text, fontWeight: '600' },
  mark: { width: 28, height: 28, borderRadius: 7, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  markText: { fontFamily: font, fontSize: 13, fontWeight: '700', color: theme.text },
})
