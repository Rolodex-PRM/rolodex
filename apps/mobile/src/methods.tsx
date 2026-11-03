import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useAccent } from './accent'
import { Icon } from './icons'
import { font, theme } from './theme'

const presets = [
  { id: 'home', title: 'Personal' },
  { id: 'work', title: 'Professional' },
  { id: 'other', title: 'Other' },
] as const

export type MethodDraft = { label: string; value: string }

function presetId(label: string) {
  const key = label.trim().toLowerCase()
  return presets.find((item) => item.id === key || item.title.toLowerCase() === key)?.id
}

export function methodTitle(label: string) {
  const id = presetId(label)
  return presets.find((item) => item.id === id)?.title ?? (label.trim() || 'Other')
}

function labelKey(kind: 'email' | 'phone') {
  return `rolodex.method-labels.${kind}`
}

function storedLabels(kind: 'email' | 'phone') {
  if (typeof localStorage === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(labelKey(kind)) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0 && !presetId(item))
  } catch {
    return []
  }
}

function rememberLabel(kind: 'email' | 'phone', label: string) {
  const next = label.trim()
  if (!next || presetId(next) || typeof localStorage === 'undefined') return storedLabels(kind)
  const labels = [...new Set([...storedLabels(kind), next])]
  localStorage.setItem(labelKey(kind), JSON.stringify(labels))
  return labels
}

export function MethodList({
  kind,
  rows,
  onChange,
}: {
  kind: 'email' | 'phone'
  rows: MethodDraft[]
  onChange: (rows: MethodDraft[]) => void
}) {
  const { accent } = useAccent()
  const [open, setOpen] = useState<number | null>(null)
  const [custom, setCustom] = useState('')
  const [catalog, setCatalog] = useState<string[]>(() => storedLabels(kind))
  const noun = kind === 'email' ? 'email' : 'phone'
  const extras = [...new Set([...catalog, ...rows.map((row) => row.label.trim()).filter((label) => label && !presetId(label))])]

  function update(index: number, patch: Partial<MethodDraft>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  function choose(index: number, label: string) {
    const id = presetId(label) ?? label.trim()
    if (!presetId(id)) setCatalog(rememberLabel(kind, id))
    update(index, { label: id })
    setOpen(null)
    setCustom('')
  }

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>{noun}</Text>
      <View style={styles.group}>
        {rows.map((row, index) => (
          <View key={`${kind}-${index}`} style={styles.row}>
            <Pressable
              accessibilityLabel={`Remove ${noun}`}
              onPress={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              style={styles.minus}
            >
              <Text style={styles.minusText}>−</Text>
            </Pressable>
            <Pressable onPress={() => { setOpen(open === index ? null : index); setCustom('') }} style={styles.labelButton}>
              <Text style={[styles.label, { color: accent }]} numberOfLines={1}>{methodTitle(row.label)}</Text>
              <Text style={[styles.chevron, { color: accent }]}>›</Text>
            </Pressable>
            <TextInput
              value={row.value}
              onChangeText={(value) => update(index, { value })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={kind === 'email' ? 'email-address' : 'phone-pad'}
              placeholder={kind === 'email' ? 'name@example.com' : 'Phone'}
              placeholderTextColor={theme.muted}
              style={styles.value}
            />
            {open === index ? (
              <View style={styles.menu}>
                {presets.map((item) => (
                  <Pressable key={item.id} onPress={() => choose(index, item.id)} style={styles.option}>
                    <Text style={[styles.optionText, presetId(row.label) === item.id && styles.optionOn]}>{item.title}</Text>
                  </Pressable>
                ))}
                {extras.map((label) => (
                  <Pressable key={label} onPress={() => choose(index, label)} style={styles.option}>
                    <Text style={[styles.optionText, row.label.trim().toLowerCase() === label.toLowerCase() && styles.optionOn]}>{label}</Text>
                  </Pressable>
                ))}
                <View style={styles.custom}>
                  <TextInput
                    value={custom}
                    onChangeText={setCustom}
                    placeholder="Custom label"
                    placeholderTextColor={theme.muted}
                    style={styles.customInput}
                    onSubmitEditing={() => {
                      if (custom.trim()) choose(index, custom.trim())
                    }}
                  />
                  <Pressable onPress={() => { if (custom.trim()) choose(index, custom.trim()) }} style={styles.use}>
                    <Text style={[styles.useText, { color: accent }]}>Use</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ))}
        <Pressable
          onPress={() => {
            onChange([...rows, { label: 'home', value: '' }])
            setOpen(null)
          }}
          style={styles.add}
        >
          <View style={styles.plus}>
            <Icon name="plus" color={theme.text} size={14} />
          </View>
          <Text style={styles.addText}>add {noun}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  heading: { color: theme.muted, fontSize: 11, fontFamily: font, letterSpacing: 0.8, textTransform: 'uppercase' },
  group: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: theme.border, flexWrap: 'wrap' },
  minus: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  minusText: { color: theme.text, fontSize: 16, lineHeight: 18, fontWeight: '700', marginTop: -1 },
  labelButton: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 132 },
  label: { fontFamily: font, fontSize: 16, flexShrink: 1 },
  chevron: { fontSize: 18, lineHeight: 20 },
  value: { flex: 1, minWidth: 140, fontFamily: font, fontSize: 16, color: theme.text, paddingVertical: 12 },
  menu: { width: '100%', backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border },
  option: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border },
  optionText: { fontFamily: font, fontSize: 15, color: theme.text },
  optionOn: { fontWeight: '700' },
  custom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  customInput: { flex: 1, fontFamily: font, fontSize: 15, color: theme.text, backgroundColor: theme.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  use: { paddingHorizontal: 8, paddingVertical: 8 },
  useText: { fontFamily: font, fontSize: 15, fontWeight: '700' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 12 },
  plus: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  addText: { fontFamily: font, fontSize: 16, color: theme.text },
})
