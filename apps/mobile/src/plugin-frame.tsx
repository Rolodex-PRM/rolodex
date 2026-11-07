import { createElement, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { api, download, send } from './api'
import { useAuth } from './auth'
import { font, theme } from './theme'

type Frame = { name: string; html: string }

export function PluginFrame({ pluginId, contactId, height = 640, showTitle = false }: { pluginId: string; contactId?: string; height?: number; showTitle?: boolean }) {
  const { workspace } = useAuth()
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
      const data = event.data as { type?: string; id?: string; method?: string; args?: { id?: string; filename?: string } }
      if (data?.type === 'rolodex:ready') {
        source.postMessage({ type: 'rolodex:context', contactId: contactId ?? null }, '*')
        return
      }
      if (data.type !== 'rolodex:invoke' || !data.id || !data.method) return
      if (data.method === 'files.download') {
        const filename = data.args?.filename && /^[A-Za-z0-9._-]{1,80}$/.test(data.args.filename) ? data.args.filename : 'export'
        const fileId = data.args?.id
        if (!fileId) {
          source.postMessage({ id: data.id, error: 'Choose a file' }, '*')
          return
        }
        void download(`/api/workspaces/${workspace.id}/plugins/${pluginId}/files/${fileId}`, filename, 'GET')
          .then(() => source.postMessage({ id: data.id, result: { ok: true } }, '*'))
          .catch((caught: Error) => source.postMessage({ id: data.id, error: caught.message }, '*'))
        return
      }
      void send(`/api/workspaces/${workspace.id}/plugins/${pluginId}/call`, 'PUT', { method: data.method, args: data.args ?? {} })
        .then((result) => source.postMessage({ id: data.id, result }, '*'))
        .catch((caught: Error) => source.postMessage({ id: data.id, error: caught.message }, '*'))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [workspace, pluginId, contactId])

  if (error) return <Text style={styles.error}>{error}</Text>
  if (!frame) return <Text style={styles.meta}>Opening plugin…</Text>
  if (Platform.OS !== 'web') return <Text style={styles.meta}>Plugins open in the browser.</Text>

  return (
    <View style={styles.page}>
      {showTitle ? <Text style={styles.title}>{frame.name}</Text> : null}
      {createElement('iframe', {
    ref: (node: HTMLIFrameElement | null) => {
      view.current = node
    },
    title: frame.name,
    sandbox: 'allow-scripts allow-downloads',
    srcDoc: frame.html,
        style: { width: '100%', height, border: 0, borderRadius: 16, background: theme.surface },
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
