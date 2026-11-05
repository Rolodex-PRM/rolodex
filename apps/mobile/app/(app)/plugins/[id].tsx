import { createElement, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { api, send } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'

type Frame = { name: string; html: string }

export default function PluginPage() {
  const { workspace } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const pluginId = typeof id === 'string' ? id : ''
  const [frame, setFrame] = useState<Frame | null>(null)
  const [error, setError] = useState('')
  const view = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    if (!workspace || !pluginId) return
    setFrame(null)
    setError('')
    api<Frame>(`/api/workspaces/${workspace.id}/plugins/${pluginId}/document`).then(setFrame).catch((caught: Error) => setError(caught.message))
  }, [workspace, pluginId])

  useEffect(() => {
    if (Platform.OS !== 'web' || !workspace || !pluginId) return
    function onMessage(event: MessageEvent) {
      const source = view.current?.contentWindow
      if (!source || event.source !== source) return
      const data = event.data as { type?: string; id?: string; method?: string; args?: unknown }
      if (data?.type === 'rolodex:ready') {
        source.postMessage({ type: 'rolodex:context' }, '*')
        return
      }
      if (data.type !== 'rolodex:invoke' || !data.id || !data.method) return
      void send(`/api/workspaces/${workspace.id}/plugins/${pluginId}/call`, 'PUT', { method: data.method, args: data.args ?? {} })
        .then((result) => source.postMessage({ id: data.id, result }, '*'))
        .catch((caught: Error) => source.postMessage({ id: data.id, error: caught.message }, '*'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [workspace, pluginId])

  if (error) return <Text style={styles.error}>{error}</Text>
  if (!frame) return <Text style={styles.meta}>Opening plugin…</Text>
  if (Platform.OS !== 'web') return <Text style={styles.meta}>Plugins open in the browser.</Text>

  return (
    <View style={styles.page}>
      <Text style={styles.title}>{frame.name}</Text>
      {createElement('iframe', {
        ref: (node: HTMLIFrameElement | null) => {
          view.current = node
        },
        title: frame.name,
        sandbox: 'allow-scripts',
        srcDoc: frame.html,
        style: { width: '100%', height: 640, border: 0, borderRadius: 16, background: theme.surface },
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 15 },
  error: { fontFamily: font, color: theme.danger, fontSize: 15 },
})
