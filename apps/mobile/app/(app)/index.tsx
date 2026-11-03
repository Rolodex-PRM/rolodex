import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, type Agenda } from '../../src/api'
import { AgendaStrip } from '../../src/agenda'
import { Memories } from '../../src/memories'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Button } from '../../src/ui'
import { NetworkPanel } from './network'

type CalendarEvent = { date: string; kind: string; title: string; contactId: string | null; eventId: string | null }

export default function Home() {
  const { workspace } = useAuth()
  const router = useRouter()
  const [agenda, setAgenda] = useState<Agenda | null>(null)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [duplicates, setDuplicates] = useState(0)
  const today = new Date()

  useEffect(() => {
    if (!workspace) return
    api<Agenda>(`/api/workspaces/${workspace.id}/agenda`).then(setAgenda).catch(() => setAgenda(null))
    api<{ events: CalendarEvent[] }>(`/api/workspaces/${workspace.id}/calendar?year=${today.getFullYear()}&month=${today.getMonth() + 1}`).then((result) => setEvents(result.events.slice(0, 5))).catch(() => setEvents([]))
    api<{ contacts: { id: string }[] }[]>(`/api/workspaces/${workspace.id}/duplicates`).then((groups) => setDuplicates(groups.length)).catch(() => setDuplicates(0))
  }, [workspace])

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{workspace?.name}</Text>
          <Text style={styles.title}>Home</Text>
        </View>
        <View style={styles.actions}>
          <Button label="Calendar" tone="ghost" onPress={() => router.push('/calendar')} />
          <Button label="Contacts" onPress={() => router.push('/contacts')} />
        </View>
      </View>
      <AgendaStrip agenda={agenda} />
      {workspace ? <Memories workspaceId={workspace.id} /> : null}
      {duplicates ? (
        <Pressable accessibilityLabel="Review duplicates" onPress={() => router.push('/settings?tab=duplicates')} style={styles.banner}>
          <Text style={styles.bannerText}>{duplicates} possible duplicate {duplicates === 1 ? 'group' : 'groups'} to review</Text>
        </Pressable>
      ) : null}
      <View style={styles.upcoming}>
        <Text style={styles.section}>This month</Text>
        {events.map((event) => (
          <Text key={`${event.date}-${event.kind}-${event.title}`} style={styles.line}>{event.date} · {event.kind} · {event.title}</Text>
        ))}
        {!events.length ? <Text style={styles.meta}>Nothing dated this month.</Text> : null}
      </View>
      <NetworkPanel />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', gap: 8 },
  kicker: { fontFamily: font, color: theme.muted, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontFamily: font, fontSize: 40, fontWeight: '700', color: theme.text, letterSpacing: -1 },
  section: { fontFamily: font, fontSize: 13, color: theme.muted, letterSpacing: 0.4, marginBottom: 8 },
  meta: { fontFamily: font, color: theme.muted },
  line: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 4 },
  upcoming: { gap: 2 },
  banner: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 14 },
  bannerText: { fontFamily: font, color: theme.text, fontWeight: '700' },
})
