import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  assertCron,
  describeCron,
  fieldHint,
  joinCron,
  nextCronRuns,
  splitCron,
  type CronFields,
} from './cron'
import { font, theme } from './theme'

type FieldKey = 0 | 1 | 2 | 3 | 4

const LABELS: { key: FieldKey; title: string; kind: 'minute' | 'hour' | 'day' | 'month' | 'weekday'; presets: { label: string; value: string }[] }[] = [
  {
    key: 0,
    title: 'Minute',
    kind: 'minute',
    presets: [
      { label: '0', value: '0' },
      { label: '15', value: '15' },
      { label: '30', value: '30' },
      { label: 'Every 15', value: '*/15' },
      { label: 'Every 30', value: '*/30' },
      { label: 'Every', value: '*' },
    ],
  },
  {
    key: 1,
    title: 'Hour',
    kind: 'hour',
    presets: [
      { label: '3 AM', value: '3' },
      { label: '6 AM', value: '6' },
      { label: '9 AM', value: '9' },
      { label: 'Noon', value: '12' },
      { label: 'Every 6h', value: '*/6' },
      { label: 'Every 12h', value: '*/12' },
      { label: 'Every', value: '*' },
    ],
  },
  {
    key: 2,
    title: 'Day',
    kind: 'day',
    presets: [
      { label: 'Every', value: '*' },
      { label: '1st', value: '1' },
      { label: '15th', value: '15' },
    ],
  },
  {
    key: 3,
    title: 'Month',
    kind: 'month',
    presets: [
      { label: 'Every', value: '*' },
      { label: 'Jan', value: '1' },
      { label: 'Jul', value: '7' },
    ],
  },
  {
    key: 4,
    title: 'Weekday',
    kind: 'weekday',
    presets: [
      { label: 'Every', value: '*' },
      { label: 'Weekdays', value: '1-5' },
      { label: 'Sun', value: '0' },
      { label: 'Sat', value: '6' },
      { label: 'Mon', value: '1' },
    ],
  },
]

const QUICK: { label: string; cron: string }[] = [
  { label: 'Daily 3 AM', cron: '0 3 * * *' },
  { label: 'Weekdays 3 AM', cron: '0 3 * * 1-5' },
  { label: 'Weekly Sunday', cron: '0 3 * * 0' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
]

export function CronSchedule({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const [active, setActive] = useState<FieldKey | null>(null)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')

  const fields = useMemo(() => {
    try {
      return splitCron(value)
    } catch {
      return splitCron('0 3 * * *')
    }
  }, [value])

  const description = useMemo(() => describeCron(value), [value])
  const nextRuns = useMemo(() => {
    try {
      return nextCronRuns(value, new Date(), 2)
    } catch {
      return []
    }
  }, [value])

  function commit(nextFields: CronFields) {
    const cron = joinCron(nextFields)
    try {
      onChange(assertCron(cron))
      setError('')
      setDraft(cron)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid schedule')
    }
  }

  function setField(index: FieldKey, fieldValue: string) {
    const next = [...fields] as CronFields
    next[index] = fieldValue.trim() || '*'
    commit(next)
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headCopy}>
          <Text style={styles.title}>Schedule</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
        <View style={styles.cronChip}>
          <Text style={styles.cronText}>{value}</Text>
        </View>
      </View>

      <View style={styles.quick}>
        {QUICK.map((item) => {
          const selected = item.cron === value
          return (
            <Pressable key={item.cron} onPress={() => onChange(item.cron)} style={[styles.quickChip, selected && styles.quickChipOn]}>
              <Text style={[styles.quickText, selected && styles.quickTextOn]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <View style={styles.grid}>
        {LABELS.map((column) => {
          const selected = active === column.key
          return (
            <Pressable key={column.title} onPress={() => setActive(selected ? null : column.key)} style={[styles.cell, selected && styles.cellOn]}>
              <Text style={styles.cellLabel}>{column.title}</Text>
              <Text style={styles.cellValue}>{fields[column.key]}</Text>
              <Text style={styles.cellHint}>{fieldHint(fields[column.key]!, column.kind)}</Text>
            </Pressable>
          )
        })}
      </View>

      {active !== null ? (
        <View style={styles.editor}>
          <Text style={styles.editorLabel}>Edit {LABELS[active]!.title.toLowerCase()}</Text>
          <View style={styles.presets}>
            {LABELS[active]!.presets.map((preset) => (
              <Pressable key={preset.value} onPress={() => setField(active, preset.value)} style={styles.preset}>
                <Text style={styles.presetText}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={fields[active]}
            onChangeText={(text) => setField(active, text)}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
      ) : null}

      <View style={styles.advanced}>
        <Text style={styles.editorLabel}>Cron expression</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => {
            try {
              onChange(assertCron(draft))
              setError('')
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Invalid cron')
            }
          }}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.note}>Times use this server’s local timezone.</Text>
      </View>

      <View style={styles.next}>
        <Text style={styles.nextTitle}>Next runs</Text>
        {nextRuns.length === 0 ? <Text style={styles.note}>No upcoming runs for this expression.</Text> : null}
        {nextRuns.map((run, index) => (
          <View key={run.toISOString()} style={styles.nextRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{index + 1}</Text>
            </View>
            <Text style={styles.nextText}>
              {run.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 12, backgroundColor: theme.raised },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  headCopy: { flex: 1, gap: 4, minWidth: 0 },
  title: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
  description: { fontFamily: font, color: theme.muted, fontSize: 14, lineHeight: 20 },
  cronChip: { borderRadius: 999, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 10, paddingVertical: 6 },
  cronText: { fontFamily: font, color: theme.text, fontSize: 12, fontWeight: '600' },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickChip: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.surface },
  quickChipOn: { backgroundColor: theme.text, borderColor: theme.text },
  quickText: { fontFamily: font, color: theme.text, fontSize: 12, fontWeight: '600' },
  quickTextOn: { color: theme.on },
  grid: { flexDirection: 'row', gap: 6 },
  cell: { flex: 1, minWidth: 0, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, paddingVertical: 10, paddingHorizontal: 6, gap: 4 },
  cellOn: { borderColor: theme.text, backgroundColor: theme.accentMuted },
  cellLabel: { fontFamily: font, color: theme.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  cellValue: { fontFamily: font, color: theme.text, fontSize: 16, fontWeight: '700' },
  cellHint: { fontFamily: font, color: theme.muted, fontSize: 11, lineHeight: 14 },
  editor: { gap: 8 },
  editorLabel: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  preset: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.surface },
  presetText: { fontFamily: font, color: theme.text, fontSize: 12, fontWeight: '600' },
  input: {
    fontFamily: font,
    color: theme.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: theme.surface,
  },
  advanced: { gap: 6 },
  note: { fontFamily: font, color: theme.muted, fontSize: 12 },
  error: { fontFamily: font, color: theme.danger, fontSize: 12 },
  next: { gap: 8 },
  nextTitle: { fontFamily: font, color: theme.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.text, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: font, color: theme.on, fontSize: 11, fontWeight: '700' },
  nextText: { fontFamily: font, color: theme.text, fontSize: 14 },
})
