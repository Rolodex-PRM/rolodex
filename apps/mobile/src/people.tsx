import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { api, type ContactSummary } from './api'
import { font, theme } from './theme'

export function titleRelationship(value: string) {
  if (value !== value.toLowerCase()) return value
  return value.replace(/[\p{L}\p{N}]+/gu, (word) => word.charAt(0).toUpperCase() + word.slice(1))
}

export function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  )
}

export function PersonPicker({
  workspaceId,
  selected,
  onToggle,
  exclude,
}: {
  workspaceId: string
  selected: string[]
  onToggle: (id: string) => void
  exclude?: string
}) {
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<ContactSummary[]>([])

  useEffect(() => {
    api<{ contacts: ContactSummary[] }>(`/api/workspaces/${workspaceId}/contacts`)
      .then((result) => setPeople(result.contacts))
      .catch(() => setPeople([]))
  }, [workspaceId])

  const shown = people
    .filter((person) => person.id !== exclude && person.displayName.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8)

  return (
    <View style={styles.wrap}>
      <TextInput value={q} onChangeText={setQ} placeholder="Find a person" placeholderTextColor={theme.muted} style={styles.input} />
      {shown.map((person) => {
        const on = selected.includes(person.id)
        return (
          <Pressable key={person.id} onPress={() => onToggle(person.id)} style={[styles.person, on && styles.personOn]}>
            <Text style={[styles.personText, on && styles.personTextOn]}>{person.displayName}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function mentionedIds(text: string, people: { id: string; displayName: string }[]) {
  const sorted = [...people].sort((left, right) => right.displayName.length - left.displayName.length)
  const ids: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '@') continue
    const before = index === 0 ? ' ' : text[index - 1] ?? ' '
    if (!/\s/.test(before)) continue
    const after = text.slice(index + 1)
    const match = sorted.find((person) => {
      if (!after.toLowerCase().startsWith(person.displayName.toLowerCase())) return false
      const next = after[person.displayName.length]
      return next === undefined || /[\s,.]/.test(next)
    })
    if (match) ids.push(match.id)
  }
  return [...new Set(ids)]
}

export function mentionParts(text: string, people: { id: string; displayName: string }[]) {
  const sorted = [...people].sort((left, right) => right.displayName.length - left.displayName.length)
  const parts: { text: string; id?: string }[] = []
  let plain = ''
  for (let index = 0; index < text.length; index += 1) {
    const atStart = index === 0 || /\s/.test(text[index - 1] ?? '')
    if (text[index] === '@' && atStart) {
      const after = text.slice(index + 1)
      const match = sorted.find((person) => {
        if (!after.toLowerCase().startsWith(person.displayName.toLowerCase())) return false
        const next = after[person.displayName.length]
        return next === undefined || /[\s,.]/.test(next)
      })
      if (match) {
        if (plain) parts.push({ text: plain })
        plain = ''
        parts.push({ text: `@${match.displayName}`, id: match.id })
        index += match.displayName.length
        continue
      }
    }
    plain += text[index]
  }
  if (plain) parts.push({ text: plain })
  return parts
}

export function MentionField({
  workspaceId,
  label,
  value,
  onChange,
  placeholder = 'Type @ to add people',
  plain = false,
}: {
  workspaceId: string
  label?: string
  value: string
  onChange: (value: string, contactIds: string[]) => void
  placeholder?: string
  plain?: boolean
}) {
  const [people, setPeople] = useState<ContactSummary[]>([])
  const [cursor, setCursor] = useState(value.length)

  useEffect(() => {
    api<{ contacts: ContactSummary[] }>(`/api/workspaces/${workspaceId}/contacts`)
      .then((result) => setPeople(result.contacts))
      .catch(() => setPeople([]))
  }, [workspaceId])

  useEffect(() => {
    onChange(value, mentionedIds(value, people))
  }, [people])

  const before = value.slice(0, cursor)
  const at = before.lastIndexOf('@')
  const lead = at <= 0 ? ' ' : before[at - 1] ?? ' '
  const query = at >= 0 && /\s/.test(lead) ? before.slice(at + 1) : null
  const open = query !== null && !query.includes('\n') && !query.endsWith(' ')
  const needle = (query ?? '').trim().toLowerCase()
  const shown = open ? people.filter((person) => !needle || person.displayName.toLowerCase().includes(needle)).slice(0, 8) : []

  function choose(person: ContactSummary) {
    const next = `${before.slice(0, at)}@${person.displayName} ${value.slice(cursor)}`
    const caret = at + person.displayName.length + 2
    setCursor(caret)
    onChange(next, mentionedIds(next, people))
  }

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.mentionLabel}>{label}</Text> : null}
      <TextInput
        multiline
        value={value}
        onChangeText={(next) => {
          setCursor((current) => Math.max(0, Math.min(next.length, current + next.length - value.length)))
          onChange(next, mentionedIds(next, people))
        }}
        onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        style={[plain ? styles.plain : styles.input, styles.mention]}
      />
      {shown.map((person) => (
        <Pressable key={person.id} onPress={() => choose(person)} style={styles.person}>
          <Text style={styles.personText}>{person.displayName}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: font, color: theme.text, backgroundColor: theme.surface },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: theme.surface },
  chipOn: { backgroundColor: theme.text, borderColor: theme.text },
  chipText: { fontFamily: font, color: theme.text, fontSize: 13 },
  chipTextOn: { color: theme.on },
  mentionLabel: { fontFamily: font, color: theme.muted, fontSize: 13 },
  mention: { minHeight: 72, textAlignVertical: 'top' },
  plain: { fontFamily: font, color: theme.text, fontSize: 15, minHeight: 72, textAlignVertical: 'top' },
  person: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.bg },
  personOn: { backgroundColor: theme.text },
  personText: { fontFamily: font, color: theme.text },
  personTextOn: { color: theme.on },
})
