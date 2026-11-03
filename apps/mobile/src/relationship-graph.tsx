import { createElement, useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api } from './api'
import { font, theme } from './theme'
import { Panel } from './ui'

const palette = ['#2563eb', '#b45309', '#047857', '#7c3aed', '#be123c', '#0f766e', '#c2410c', '#4338ca']

type Node = { id: string; name: string }
type Edge = { id: string; from: string; to: string; type: string; inferred: boolean }

export function RelationshipGraph({ workspaceId, contactId, name }: { workspaceId: string; contactId: string; name: string }) {
  const router = useRouter()
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  useEffect(() => {
    api<{ nodes: Node[]; edges: Edge[] }>(`/api/workspaces/${workspaceId}/contacts/${contactId}/network`)
      .then((result) => {
        setNodes(result.nodes.some((node) => node.id === contactId) ? result.nodes : [{ id: contactId, name }, ...result.nodes])
        setEdges(result.edges)
      })
      .catch(() => {
        setNodes([])
        setEdges([])
      })
  }, [workspaceId, contactId, name])

  const others = nodes.filter((node) => node.id !== contactId)
  const types = [...new Set(edges.map((edge) => edge.type))]
  const colorFor = (type: string) => palette[Math.abs(hash(type)) % palette.length] ?? palette[0]

  return (
    <Panel>
      <Text style={styles.section}>Relationships</Text>
      {!others.length ? <Text style={styles.meta}>No relationships yet.</Text> : null}
      {others.length && Platform.OS === 'web' ? <Graph name={name} contactId={contactId} nodes={others} edges={edges} colorFor={colorFor} onOpen={(id) => router.push(`/contacts/${id}`)} /> : null}
      {others.length && Platform.OS !== 'web'
        ? edges.filter((edge) => edge.from === contactId).map((edge) => (
          <Pressable key={edge.id} onPress={() => router.push(`/contacts/${edge.to}`)}>
            <Text style={styles.link}><Text style={{ color: colorFor(edge.type) }}>● </Text>{edge.type} · {nodes.find((node) => node.id === edge.to)?.name}</Text>
          </Pressable>
        ))
        : null}
      {types.length ? (
        <View style={styles.legend}>
          {types.map((type) => (
            <View key={type} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colorFor(type) }]} />
              <Text style={styles.meta}>{type}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Panel>
  )
}

function Graph({ name, contactId, nodes, edges, colorFor, onOpen }: { name: string; contactId: string; nodes: Node[]; edges: Edge[]; colorFor: (type: string) => string; onOpen: (id: string) => void }) {
  const width = 560
  const height = 320
  const cx = width / 2
  const cy = height / 2
  const radius = 110
  const spot = (index: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / nodes.length
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }
  }
  const at = new Map<string, { x: number; y: number }>([[contactId, { x: cx, y: cy }], ...nodes.map((node, index) => [node.id, spot(index)] as const)])
  return (
    <View style={styles.graph}>
      {createElement('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}` }, edges.map((edge) => {
        const from = at.get(edge.from)
        const to = at.get(edge.to)
        if (!from || !to) return null
        return createElement('line', { key: edge.id, x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: colorFor(edge.type), strokeWidth: 2, strokeDasharray: edge.inferred ? '5 4' : undefined })
      }))}
      <View style={[styles.node, styles.center]}>
        <Text style={styles.nodeText} numberOfLines={2}>{name}</Text>
      </View>
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
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  link: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 6 },
  graph: { height: 320, position: 'relative' },
  node: { position: 'absolute', width: 92, marginLeft: -46, marginTop: -22, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, alignItems: 'center' },
  center: { left: '50%', top: '50%', borderColor: theme.text },
  nodeText: { fontFamily: font, color: theme.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
})
