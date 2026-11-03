import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { api } from './api'
import { font, theme } from './theme'
import { Panel } from './ui'

export function ContactSummary({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const [text, setText] = useState('')

  useEffect(() => {
    api<{ text: string }>(`/api/workspaces/${workspaceId}/contacts/${contactId}/summary`).then((result) => setText(result.text)).catch(() => setText(''))
  }, [workspaceId, contactId])

  if (!text) return null
  return (
    <Panel>
      <Text style={styles.section}>Summary</Text>
      <Text style={styles.body}>{text}</Text>
    </Panel>
  )
}

const styles = StyleSheet.create({
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  body: { fontFamily: font, color: theme.text, fontSize: 15 },
})
