import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native'
import { suggestIndustries } from './naics'
import { font, theme } from './theme'

export function TagField({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const hold = useRef(false)
  const input = useRef<TextInputInstance>(null)
  const matches = open ? fuzzyTags(suggestions, tags, draft) : []

  useEffect(() => {
    const node = input.current as unknown as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } | null
    if (!node?.addEventListener || !node.removeEventListener) return
    const openMenu = () => setOpen(true)
    node.addEventListener('pointerdown', openMenu)
    return () => node.removeEventListener?.('pointerdown', openMenu)
  }, [])

  function add(name: string) {
    const next = name.trim()
    if (!next || tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...tags, next])
    setDraft('')
  }

  return (
    <View style={styles.block}>
      <Text style={styles.label}>Tags</Text>
      <View style={styles.chips}>
        {tags.map((tag) => (
          <Pressable key={tag} onPress={() => onChange(tags.filter((item) => item !== tag))} style={styles.chip}>
            <Text style={styles.chipText}>{tag}  ×</Text>
          </Pressable>
        ))}
        <TextInput
          ref={input}
          value={draft}
          onChangeText={(text) => {
            setOpen(true)
            if (!/[,;]/.test(text)) {
              setDraft(text)
              return
            }
            const parts = text.split(/[,;]/)
            const pending = parts.pop() ?? ''
            const next = [...tags]
            for (const part of parts) {
              const name = part.trim()
              if (name && !next.some((tag) => tag.toLowerCase() === name.toLowerCase())) next.push(name)
            }
            if (next.length !== tags.length) onChange(next)
            setDraft(pending.replace(/^\s+/, ''))
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => {
              if (hold.current) {
                hold.current = false
                return
              }
              setOpen(false)
            }, 200)
          }}
          onSubmitEditing={() => add(draft)}
          placeholder={tags.length ? 'Add another tag' : 'Add a tag'}
          placeholderTextColor={theme.muted}
          style={styles.input}
        />
      </View>
      {matches.length ? (
        <View style={styles.menu}>
          {matches.map((name) => (
            <Pressable key={name} onPressIn={() => { hold.current = true; input.current?.focus() }} onPress={() => add(name)} style={styles.option}>
              <Text style={styles.optionText}>{name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function fuzzyTags(suggestions: string[], used: string[], query: string) {
  const taken = new Set(used.map((tag) => tag.toLowerCase()))
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return suggestions
    .filter((name) => !taken.has(name.toLowerCase()))
    .map((name) => ({ name, score: fuzzyScore(needle, name.toLowerCase()) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((item) => item.name)
}

function fuzzyScore(query: string, name: string) {
  if (name === query) return 1000
  if (name.startsWith(query)) return 800
  const contains = name.indexOf(query)
  if (contains >= 0) return 600 - contains
  let queryIndex = 0
  let score = 0
  let streak = 0
  for (let index = 0; index < name.length && queryIndex < query.length; index += 1) {
    if (name[index] !== query[queryIndex]) {
      streak = 0
      continue
    }
    streak += 1
    score += 8 + streak * 4
    if (index === 0 || name[index - 1] === ' ') score += 6
    queryIndex += 1
  }
  return queryIndex === query.length ? score : 0
}

export function IndustryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const hold = useRef(false)
  const input = useRef<TextInputInstance>(null)
  const matches = open ? suggestIndustries(value) : []
  useEffect(() => {
    const node = input.current as unknown as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } | null
    if (!node?.addEventListener || !node.removeEventListener) return
    const openMenu = () => setOpen(true)
    node.addEventListener('pointerdown', openMenu)
    return () => node.removeEventListener?.('pointerdown', openMenu)
  }, [])
  return (
    <View style={styles.block}>
      <Text style={styles.label}>Industry</Text>
      <TextInput
        ref={input}
        value={value}
        onChangeText={(text) => {
          onChange(text)
          setOpen(true)
          setInfo(null)
        }}
        onPressIn={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            const stayed = hold.current && input.current?.isFocused()
            hold.current = false
            if (stayed) return
            setOpen(false)
            setInfo(null)
          }, 200)
        }}
        placeholder="NAICS subsector"
        placeholderTextColor={theme.muted}
        autoCapitalize="words"
        style={styles.search}
      />
      {open ? (
        <View style={styles.menu}>
          <ScrollView style={styles.menuScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {matches.length ? matches.map((item) => (
            <View key={item.code}>
              <View style={styles.optionRow}>
                <Pressable
                  onPressIn={() => { hold.current = true; input.current?.focus() }}
                  onPress={() => { onChange(item.title); setOpen(false); setInfo(null) }}
                  style={styles.optionMain}
                >
                  <Text style={styles.optionText}>{item.code}  {item.title}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`About ${item.title}`}
                  onPressIn={() => { hold.current = true; input.current?.focus() }}
                  onPress={() => setInfo((current) => (current === item.code ? null : item.code))}
                  style={styles.info}
                >
                  <Text style={styles.infoText}>i</Text>
                </Pressable>
              </View>
              {info === item.code ? <Text style={styles.definition}>{item.definition}</Text> : null}
            </View>
          )) : <Text style={styles.definition}>No matching subsectors</Text>}
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  label: { color: theme.muted, fontSize: 11, fontFamily: font, letterSpacing: 0.8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 8 },
  chip: { backgroundColor: theme.text, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: theme.on, fontFamily: font, fontSize: 13 },
  input: { minWidth: 140, flexGrow: 1, fontFamily: font, fontSize: 15, color: theme.text, paddingVertical: 6, paddingHorizontal: 6 },
  search: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: font, fontSize: 15, color: theme.text },
  menu: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' },
  menuScroll: { maxHeight: 280 },
  option: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  optionRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border },
  optionMain: { flex: 1, paddingHorizontal: 14, paddingVertical: 10 },
  info: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  infoText: { fontFamily: font, color: theme.muted, fontSize: 13, fontStyle: 'italic', fontWeight: '700' },
  definition: { fontFamily: font, color: theme.muted, fontSize: 13, lineHeight: 18, paddingHorizontal: 14, paddingBottom: 12 },
  optionText: { fontFamily: font, color: theme.text, fontSize: 14 },
})
