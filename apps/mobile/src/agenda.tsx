import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Agenda } from './api'
import { font, theme } from './theme'

export function agendaLines(agenda: Agenda) {
  const lines: { key: string; label: string; href: string }[] = []
  const birthdays = new Set<string>()
  for (const date of agenda.dates) {
    if (date.kind === 'birthday') {
      if (birthdays.has(date.contactId)) continue
      birthdays.add(date.contactId)
      lines.push({ key: `birthday-${date.contactId}`, label: birthdayLabel(date.displayName, date.days), href: `/contacts/${date.contactId}` })
      continue
    }
    const when = date.days === 0 ? 'today' : date.days === 1 ? 'tomorrow' : `in ${date.days} days`
    lines.push({ key: `${date.kind}-${date.contactId}`, label: `${date.displayName}'s ${date.kind} ${when}`, href: `/contacts/${date.contactId}` })
  }
  for (const task of agenda.tasks) {
    const overdue = task.dueAt ? new Date(task.dueAt).getTime() < Date.now() : false
    lines.push({ key: task.id, label: overdue ? `Overdue: ${task.title}` : `Due: ${task.title}`, href: '/tasks' })
  }
  for (const reach of agenda.reachOuts) {
    lines.push({ key: `reach-${reach.contactId}`, label: reach.label, href: `/contacts/${reach.contactId}` })
  }
  for (const reminder of agenda.reminders) {
    if (reminder.type === 'birthday') continue
    lines.push({
      key: reminder.id,
      label: `${reminder.type} · ${reminder.remindAt.slice(0, 10)}`,
      href: reminder.contactId ? `/contacts/${reminder.contactId}` : '/tasks',
    })
  }
  return lines
}

export function AgendaStrip({ agenda }: { agenda: Agenda | null }) {
  const router = useRouter()
  const lines = agenda ? agendaLines(agenda) : []
  if (!lines.length) return null
  return (
    <View style={styles.strip}>
      {lines.slice(0, 8).map((line) => (
        <Pressable key={line.key} onPress={() => router.push(line.href)} style={styles.chip}>
          <Text style={styles.text}>{line.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function birthdayLabel(name: string, days: number) {
  const when = new Date()
  when.setHours(12, 0, 0, 0)
  when.setDate(when.getDate() + days)
  const date = when.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const unit = days === 1 ? 'day' : 'days'
  return `${name}'s Birthday in ${days} ${unit} on ${date}`
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  text: { fontFamily: font, color: theme.text, fontSize: 13 },
})
