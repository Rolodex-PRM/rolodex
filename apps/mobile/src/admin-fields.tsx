import { Pressable, StyleSheet, Text, View } from 'react-native'
import { font, theme } from './theme'

export function SwitchRow({ label, detail, on, onPress }: { label: string; detail?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.thumb, on && styles.thumbOn]} />
      </View>
    </Pressable>
  )
}

export function ChoiceRow({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <View style={styles.choice}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.chips}>
        {options.map((option) => {
          const selected = option.id === value
          return (
            <Pressable key={option.id} onPress={() => onChange(option.id)} style={[styles.chip, selected && styles.chipOn]}>
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{option.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
  copy: { flex: 1, gap: 4 },
  label: { fontFamily: font, color: theme.text, fontSize: 15, fontWeight: '600' },
  detail: { fontFamily: font, color: theme.muted, fontSize: 13 },
  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: theme.border, justifyContent: 'center', padding: 3 },
  trackOn: { backgroundColor: theme.text },
  thumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.surface },
  thumbOn: { alignSelf: 'flex-end' },
  choice: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipOn: { backgroundColor: theme.text, borderColor: theme.text },
  chipText: { fontFamily: font, color: theme.text, fontSize: 13 },
  chipTextOn: { color: theme.on },
})
