import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps, type ViewProps } from 'react-native'
import { useAccent } from './accent'
import { font, theme } from './theme'

export function Field({ label, style, ...props }: { label: string; style?: ViewProps['style'] } & TextInputProps) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={theme.muted} style={styles.input} {...props} />
    </View>
  )
}

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(() => parseIso(value) ?? new Date())
  const hold = useRef(false)
  const input = useRef<TextInputInstance>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const selected = parseIso(value)
  const days = monthDays(cursor)

  function show() {
    const parsed = parseIso(valueRef.current)
    if (parsed) setCursor(parsed)
    setOpen(true)
  }

  useEffect(() => {
    const node = input.current as unknown as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } | null
    if (!node?.addEventListener || !node.removeEventListener) return
    node.addEventListener('pointerdown', show)
    return () => node.removeEventListener?.('pointerdown', show)
  }, [])

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={input}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.muted}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        onFocus={show}
        onPressIn={show}
        onBlur={() => {
          setTimeout(() => {
            if (hold.current) {
              hold.current = false
              return
            }
            setOpen(false)
          }, 200)
        }}
      />
      {open ? (
        <View style={styles.calendar}>
          <View style={styles.calendarHead}>
            <Pressable accessibilityLabel="Previous month" onPressIn={() => { hold.current = true }} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={styles.calendarNav}>
              <Text style={styles.calendarNavText}>‹</Text>
            </Pressable>
            <Text style={styles.calendarTitle}>{cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</Text>
            <Pressable accessibilityLabel="Next month" onPressIn={() => { hold.current = true }} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={styles.calendarNav}>
              <Text style={styles.calendarNavText}>›</Text>
            </Pressable>
          </View>
          <View style={styles.weekdays}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>
            ))}
          </View>
          <View style={styles.days}>
            {days.map((day) => {
              const iso = formatIso(day)
              const inMonth = day.getMonth() === cursor.getMonth()
              const on = selected ? formatIso(selected) === iso : false
              return (
                <Pressable
                  key={iso}
                  onPressIn={() => { hold.current = true }}
                  onPress={() => {
                    onChange(iso)
                    setOpen(false)
                  }}
                  style={[styles.day, on && styles.dayOn]}
                >
                  <Text style={[styles.dayText, !inMonth && styles.dayMuted, on && styles.dayTextOn]}>{day.getDate()}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function parseIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null
  return date
}

function formatIso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function monthDays(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled,
}: {
  label: string
  onPress: () => void
  tone?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
}) {
  const { accent, onAccent } = useAccent()
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, tone === 'primary' ? { backgroundColor: accent } : tone === 'danger' ? styles.danger : styles.ghost, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, tone === 'primary' && { color: onAccent }, tone === 'ghost' && styles.ghostText]}>{label}</Text>
    </Pressable>
  )
}

export function Panel({ children, style }: ViewProps) {
  return <View style={[styles.panel, style]}>{children}</View>
}

export function Notice({ text }: { text: string }) {
  return <Text style={styles.notice}>{text}</Text>
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
  button: { borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  danger: { backgroundColor: theme.danger },
  ghost: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontFamily: font, fontSize: 14, fontWeight: '600' },
  ghostText: { color: theme.text },
  panel: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 22,
    padding: 18,
  },
  notice: { color: theme.danger, fontFamily: font, fontSize: 14 },
  calendar: { borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 16, padding: 10, gap: 8 },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarTitle: { fontFamily: font, fontSize: 15, fontWeight: '700', color: theme.text },
  calendarNav: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  calendarNavText: { fontFamily: font, fontSize: 20, color: theme.text },
  weekdays: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: font, fontSize: 12, color: theme.muted },
  days: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  dayOn: { backgroundColor: theme.text },
  dayText: { fontFamily: font, fontSize: 14, color: theme.text },
  dayMuted: { color: theme.muted },
  dayTextOn: { color: theme.on },
})
