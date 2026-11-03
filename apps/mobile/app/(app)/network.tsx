import { createElement, useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api } from '../../src/api'
import { useAuth } from '../../src/auth'
import { font, theme } from '../../src/theme'
import { Panel } from '../../src/ui'

type Node = { id: string; name: string; degree: number }
type Edge = { id: string; from: string; to: string; type: string; inferred: boolean }
type FollowUp = { contactId: string; displayName: string; reason: string }
type Network = { nodes: Node[]; edges: Edge[]; insights: string[]; followUps: FollowUp[] }

const palette = ['#2563eb', '#b45309', '#047857', '#7c3aed', '#be123c', '#0f766e']

export function NetworkPanel() {
  const { workspace } = useAuth()
  const router = useRouter()
  const [data, setData] = useState<Network | null>(null)

  useEffect(() => {
    if (!workspace) return
    api<Network>(`/api/workspaces/${workspace.id}/network`).then(setData).catch(() => setData(null))
  }, [workspace])

  const shown = (data?.nodes ?? []).filter((node) => node.degree > 0).slice(0, 24)
  const ids = new Set(shown.map((node) => node.id))
  const edges = (data?.edges ?? []).filter((edge) => ids.has(edge.from) && ids.has(edge.to))

  return (
    <View style={styles.page}>
      <Text style={styles.title}>Reach out</Text>
      <Panel>
        {(data?.insights ?? []).map((line) => <Text key={line} style={styles.body}>{line}</Text>)}
      </Panel>
      {shown.length && Platform.OS === 'web' ? <Graph nodes={shown} edges={edges} onOpen={(id) => router.push(`/contacts/${id}`)} /> : null}
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

function Graph({ nodes, edges, onOpen }: { nodes: Node[]; edges: Edge[]; onOpen: (id: string) => void }) {
  const width = 640
  const height = 420
  const cx = width / 2
  const cy = height / 2
  const radius = 150
  const spot = (index: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / nodes.length
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
  }
  const at = new Map(nodes.map((node, index) => [node.id, spot(index)]))
  const color = (type: string) => palette[Math.abs(hash(type)) % palette.length] ?? palette[0]
  return (
    <View style={styles.graph}>
      {createElement('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}` }, edges.map((edge) => {
        const from = at.get(edge.from)
        const to = at.get(edge.to)
        if (!from || !to) return null
        return createElement('line', { key: edge.id, x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: color(edge.type), strokeWidth: 2, strokeDasharray: edge.inferred ? '5 4' : undefined })
      }))}
      {nodes.map((node, index) => {
        const point = spot(index)
        return (
          <Pressable key={node.id} onPress={() => onOpen(node.id)} style={[styles.node, { left: `${(point.x / width) * 100}%`, top: `${(point.y / height) * 100}%` }]}>
            <Text style={styles.nodeText} numberOfLines={2}>{node.name}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function hash(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  section: { fontFamily: font, color: theme.muted, fontSize: 13, letterSpacing: 0.4, marginBottom: 8 },
  body: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 6 },
  meta: { fontFamily: font, color: theme.muted },
  link: { fontFamily: font, color: theme.accent, fontSize: 15, marginBottom: 6 },
  graph: { height: 420, position: 'relative' },
  node: { position: 'absolute', width: 96, marginLeft: -48, marginTop: -18, padding: 6, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  nodeText: { fontFamily: font, color: theme.text, fontSize: 12, textAlign: 'center' },
})

export default function NetworkRoute() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/')
  }, [router])
  return null
}
