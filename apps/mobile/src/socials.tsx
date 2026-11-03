import { createElement, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useAccent } from './accent'
import { font, theme } from './theme'
import type { MethodDraft } from './methods'

const networks = [
  { id: 'linkedin', title: 'LinkedIn' },
  { id: 'instagram', title: 'Instagram' },
  { id: 'x', title: 'X' },
  { id: 'facebook', title: 'Facebook' },
] as const

const brand: Record<string, string> = {
  linkedin: '#0A66C2',
  instagram: '#E1306C',
  facebook: '#1877F2',
}

export function SocialIcon({ name, size = 18 }: { name: string; size?: number }) {
  const key = name.trim().toLowerCase()
  const color = brand[key] ?? theme.text
  return createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: color, 'aria-hidden': true },
    ...socialMark(key === 'twitter' ? 'x' : key, color),
  )
}

function socialMark(key: string, color: string) {
  if (key === 'linkedin') {
    return [
      createElement('path', { key: 'b', d: 'M4.5 3h15A1.5 1.5 0 0 1 21 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-15A1.5 1.5 0 0 1 4.5 3z' }),
      createElement('path', { key: 'i', fill: '#fff', d: 'M8.1 10.2H6.2V18h1.9v-7.8zM7.15 9.2a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3zM17.8 18h-1.9v-3.7c0-.9-.02-2-1.22-2-1.22 0-1.4.95-1.4 1.93V18H11.4v-7.8h1.82v1.06h.03c.25-.48.87-1 1.8-1 1.92 0 2.75 1.27 2.75 2.92V18z' }),
    ]
  }
  if (key === 'instagram') {
    return [
      createElement('rect', { key: 'r', x: 3.5, y: 3.5, width: 17, height: 17, rx: 5, fill: 'none', stroke: color, strokeWidth: 1.8 }),
      createElement('circle', { key: 'c', cx: 12, cy: 12, r: 4, fill: 'none', stroke: color, strokeWidth: 1.8 }),
      createElement('circle', { key: 'd', cx: 17.2, cy: 6.8, r: 1, fill: color }),
    ]
  }
  if (key === 'x') {
    return [createElement('path', { key: 'x', d: 'M14.6 3.5h2.7l-5.9 6.7 6.9 9.3h-5.4l-4.2-5.5-4.8 5.5H1.2l6.3-7.2L.8 3.5h5.5l3.8 5 4.5-5zm-1 14.6h1.5L6.5 5H4.9l8.7 13.1z' })]
  }
  if (key === 'facebook') {
    return [createElement('path', { key: 'f', d: 'M14 8.2h2.2V5.2H14c-2.3 0-4 1.7-4 4v1.8H8v2.8h2V20h2.8v-6.2h2.3l.6-2.8h-2.9V9.2c0-.6.4-1 1.2-1z' })]
  }
  return [createElement('path', { key: 'l', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', d: 'M10 13.2a4.2 4.2 0 0 0 6 .4l1.8-1.8a4.2 4.2 0 0 0-6-6L10.4 7.2M14 10.8a4.2 4.2 0 0 0-6-.4l-1.8 1.8a4.2 4.2 0 0 0 6 6l1.4-1.4' })]
}

export function socialTitle(label: string) {
  const key = label.trim().toLowerCase()
  return networks.find((item) => item.id === key)?.title ?? (label.trim() || 'Other')
}

export function socialHref(label: string, value: string) {
  const raw = value.trim()
  if (/^https?:\/\//i.test(raw)) return raw
  const handle = raw.replace(/^@/, '')
  const key = label.trim().toLowerCase()
  if (key === 'linkedin') return `https://www.linkedin.com/in/${encodeURIComponent(handle)}`
  if (key === 'instagram') return `https://instagram.com/${encodeURIComponent(handle)}`
  if (key === 'x' || key === 'twitter') return `https://x.com/${encodeURIComponent(handle)}`
  if (key === 'facebook') return `https://www.facebook.com/${encodeURIComponent(handle)}`
  return `https://${handle}`
}

export function SocialList({ rows, onChange }: { rows: MethodDraft[]; onChange: (rows: MethodDraft[]) => void }) {
  const { accent } = useAccent()
  const [open, setOpen] = useState<number | null>(null)
  const [custom, setCustom] = useState('')

  function update(index: number, patch: Partial<MethodDraft>) {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)))
  }

  function choose(index: number, label: string) {
    update(index, { label })
    setOpen(null)
    setCustom('')
  }

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>Social</Text>
      <View style={styles.group}>
        {rows.map((row, index) => (
          <View key={`social-${index}`} style={styles.row}>
            <Pressable accessibilityLabel="Remove social profile" onPress={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))} style={styles.minus}>
              <Text style={styles.minusText}>−</Text>
            </Pressable>
            <Pressable onPress={() => { setOpen(open === index ? null : index); setCustom('') }} style={styles.labelButton}>
              <SocialIcon name={row.label} size={16} />
              <Text style={[styles.label, { color: accent }]} numberOfLines={1}>{socialTitle(row.label)}</Text>
              <Text style={[styles.chevron, { color: accent }]}>›</Text>
            </Pressable>
            <TextInput
              value={row.value}
              onChangeText={(value) => update(index, { value })}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Profile URL or handle"
              placeholderTextColor={theme.muted}
              style={styles.value}
            />
            {open === index ? (
              <View style={styles.menu}>
                {networks.map((item) => (
                  <Pressable key={item.id} onPress={() => choose(index, item.id)} style={styles.option}>
                    <SocialIcon name={item.id} size={16} />
                    <Text style={[styles.optionText, row.label.trim().toLowerCase() === item.id && styles.optionOn]}>{item.title}</Text>
                  </Pressable>
                ))}
                <View style={styles.custom}>
                  <TextInput
                    value={custom}
                    onChangeText={setCustom}
                    placeholder="Other network"
                    placeholderTextColor={theme.muted}
                    style={styles.customInput}
                    onSubmitEditing={() => custom.trim() && choose(index, custom.trim())}
                  />
                </View>
              </View>
            ) : null}
          </View>
        ))}
        <Pressable onPress={() => onChange([...rows, { label: 'linkedin', value: '' }])} style={styles.add}>
          <Text style={[styles.addText, { color: accent }]}>Add social profile</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  heading: { fontFamily: font, fontSize: 13, color: theme.muted, letterSpacing: 0.4, textTransform: 'uppercase' },
  group: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  minus: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  minusText: { fontFamily: font, fontSize: 22, color: theme.muted, lineHeight: 24 },
  labelButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 92 },
  label: { fontFamily: font, fontSize: 15, fontWeight: '600' },
  chevron: { fontFamily: font, fontSize: 18 },
  value: { flex: 1, minWidth: 160, fontFamily: font, fontSize: 15, color: theme.text, paddingVertical: 8 },
  menu: { width: '100%', borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.surface },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  optionText: { fontFamily: font, fontSize: 14, color: theme.text },
  optionOn: { fontWeight: '700' },
  custom: { padding: 8 },
  customInput: { fontFamily: font, fontSize: 14, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  add: { paddingVertical: 4 },
  addText: { fontFamily: font, fontSize: 14, fontWeight: '600' },
})
