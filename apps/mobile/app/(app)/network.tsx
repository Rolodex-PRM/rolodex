import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api } from '../../src/api'
import { useAuth } from '../../src/auth'
import { NetworkExplorer } from '../../src/network-explorer'
import { font, theme } from '../../src/theme'
import { Panel } from '../../src/ui'

type FollowUp = { contactId: string; displayName: string; reason: string }
type Network = { insights: string[]; followUps: FollowUp[] }

export function NetworkPanel() {
  const { workspace } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<Network | null>(null)

  useEffect(() => {
    if (!workspace) return
    api<Network>(`/api/workspaces/${workspace.id}/network`).then(setData).catch(() => setData(null))
  }, [workspace])

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Network</Text>
      <NetworkExplorer height={720} />
      <Panel>
        {(data?.insights ?? []).map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
      </Panel>
      <Panel>
        <Text style={styles.section}>Suggested follow-ups</Text>
        {(data?.followUps ?? []).map((item) => (
          <Pressable key={`${item.contactId}-${item.reason}`} onPress={() => router.push(`/contacts/${item.contactId}`)}>
            <Text style={styles.link}>{item.displayName} · {item.reason}</Text>
          </Pressable>
        ))}
        {!(data?.followUps.length) ? <Text style={styles.meta}>No one needs a nudge right now.</Text> : null}
      </Panel>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  section: { fontFamily: font, color: theme.muted, fontSize: 13, letterSpacing: 0.4, marginBottom: 8 },
  body: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 6 },
  meta: { fontFamily: font, color: theme.muted },
  link: { fontFamily: font, color: theme.accent, fontSize: 15, marginBottom: 6 },
})

export default function NetworkRoute() {
  return <NetworkPanel />
}
