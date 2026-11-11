import { useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { font, theme } from './theme'
import { Notice } from './ui'

function siteOrigin() {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return 'https://rolodex.example.com'
}

export function McpAdmin() {
  const origin = useMemo(() => siteOrigin(), [])
  const endpoint = `${origin}/mcp`
  const [copied, setCopied] = useState('')
  const config = `{
  "mcpServers": {
    "rolodex": {
      "url": "${endpoint}",
      "headers": {
        "Authorization": "Basic REPLACE_WITH_BASE64_EMAIL_AND_CLIENT_PASSWORD"
      }
    }
  }
}`

  async function copy(text: string, label: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 1400)
    } catch {
      setCopied('')
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.meta}>
        AI clients call Rolodex over the Model Context Protocol at this URL. Create a named client password under Settings, then authenticate with Basic auth
        (email + that password) or a Bearer session token. Tools stay read-only: contacts, relationships, interactions, notes, tasks, and the network graph.
      </Text>
      <Text style={styles.label}>Endpoint</Text>
      <View style={styles.row}>
        <Text selectable style={styles.code}>
          {endpoint}
        </Text>
        <Pressable onPress={() => void copy(endpoint, 'endpoint')} style={styles.button}>
          <Text style={styles.buttonText}>{copied === 'endpoint' ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <Text style={styles.label}>Example client config</Text>
      <Text selectable style={styles.block}>
        {config}
      </Text>
      <Pressable onPress={() => void copy(config, 'config')} style={styles.button}>
        <Text style={styles.buttonText}>{copied === 'config' ? 'Copied' : 'Copy config'}</Text>
      </Pressable>
      <Notice text="Replace the Authorization value with Basic credentials for your sign-in email and a Settings client password." />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14 },
  label: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  code: { flex: 1, fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '600' },
  block: {
    fontFamily: font,
    color: theme.text,
    fontSize: 12,
    lineHeight: 18,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
  },
  button: { borderWidth: 1, borderColor: theme.text, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  buttonText: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
})
