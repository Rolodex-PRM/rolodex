import { createElement, useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api } from './api'
import { font, theme } from './theme'
import { Panel } from './ui'

const palette = ['#2563eb', '#b45309', '#047857', '#7c3aed', '#be123c', '#0f766e', '#c2410c', '#4338ca']
const inverse: Record<string, string> = {
  parent: 'child',
  child: 'parent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  'great-grandparent': 'great-grandchild',
  'great-grandchild': 'great-grandparent',
  spouse: 'spouse',
  sibling: 'sibling',
  'aunt/uncle': 'niece/nephew',
  'niece/nephew': 'aunt/uncle',
  cousin: 'cousin',
  coworker: 'coworker',
  friend: 'friend',
  'boyfriend/girlfriend': 'boyfriend/girlfriend',
}
const generation: Record<string, number> = {
  'great-grandparent': 3,
  grandparent: 2,
  parent: 1,
  'aunt/uncle': 1,
  sibling: 0,
  spouse: 0,
  'boyfriend/girlfriend': 0,
  cousin: 0,
  child: -1,
  'niece/nephew': -1,
  grandchild: -2,
  'great-grandchild': -3,
}

type Node = { id: string; name: string }
type Edge = { id: string; from: string; to: string; type: string; reciprocal?: string | null; reason?: string | null; inferred: boolean }

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
  const colorFor = (type: string) => palette[Math.abs(hash(type)) % palette.length] ?? palette[0]
  const placed = others.map((node) => {
    const edge = directEdge(edges, contactId, node.id)
    const role = edge ? roleOf(edge, contactId) : 'Connected'
    return { ...node, role, inferred: Boolean(edge?.inferred), reason: edge?.reason ?? '' }
  })

  return (
    <Panel>
      <Text style={styles.section}>Relationships</Text>
      {!others.length ? <Text style={styles.meta}>No relationships yet.</Text> : null}
      {others.length && Platform.OS === 'web' ? <Graph name={name} contactId={contactId} nodes={placed} edges={edges} colorFor={colorFor} onOpen={(id) => router.push(`/contacts/${id}`)} /> : null}
      {others.length && Platform.OS !== 'web'
        ? placed.map((node) => (
          <Pressable key={node.id} onPress={() => router.push(`/contacts/${node.id}`)}>
            <Text style={styles.link}><Text style={{ color: colorFor(node.role) }}>● </Text>{node.role} · {node.name}{node.inferred ? ' · suggested' : ''}</Text>
            {node.inferred && node.reason ? <Text style={styles.meta}>{node.reason}</Text> : null}
          </Pressable>
        ))
        : null}
      {placed.some((node) => node.inferred) ? (
        <View style={styles.reasons}>
          {placed.filter((node) => node.inferred).map((node) => (
            <Text key={node.id} style={styles.meta}>{node.name} · {node.role}. {node.reason || 'Suggested from the other links.'}</Text>
          ))}
        </View>
      ) : null}
    </Panel>
  )
}

function Graph({ name, contactId, nodes, edges, colorFor, onOpen }: { name: string; contactId: string; nodes: { id: string; name: string; role: string; inferred: boolean }[]; edges: Edge[]; colorFor: (type: string) => string; onOpen: (id: string) => void }) {
  const family = new Map<number, typeof nodes>()
  const side: typeof nodes = []
  for (const node of nodes) {
    const band = generation[node.role.toLowerCase()]
    if (band == null) {
      side.push(node)
      continue
    }
    const list = family.get(band) ?? []
    list.push(node)
    family.set(band, list)
  }
  const rows: { people: typeof nodes; focus: boolean }[] = []
  let placedFocus = false
  for (const band of [...family.keys()].sort((left, right) => right - left)) {
    if (!placedFocus && band < 0) {
      rows.push({ people: family.get(0) ?? [], focus: true })
      placedFocus = true
    }
    rows.push({ people: family.get(band) ?? [], focus: band === 0 })
    if (band === 0) placedFocus = true
  }
  if (!placedFocus) rows.push({ people: [], focus: true })
  if (side.length) rows.push({ people: side, focus: false })
  const rowGap = 108
  const colGap = 128
  const widest = Math.max(...rows.map((row) => row.people.length + (row.focus ? 1 : 0)))
  const width = Math.max(560, widest * colGap + 48)
  const height = Math.max(240, rows.length * rowGap + 36)
  const at = new Map<string, { x: number; y: number }>()
  rows.forEach((row, index) => {
    const people = row.focus ? insertFocus(row.people, contactId) : row.people.map((person) => person.id)
    const y = 28 + index * rowGap
    const span = colGap * Math.max(people.length - 1, 0)
    const start = (width - span) / 2
    people.forEach((id, place) => at.set(id, { x: start + place * colGap, y }))
  })
  return (
    <View>
      <View style={[styles.graph, { height }]}>
        {createElement('svg', { width: '100%', height, viewBox: `0 0 ${width} ${height}` }, edges.map((edge) => {
          const from = at.get(edge.from)
          const to = at.get(edge.to)
          if (!from || !to) return null
          const word = edge.from === contactId || edge.to === contactId ? roleOf(edge, contactId) : edge.type
          return createElement('line', {
            key: edge.id,
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke: colorFor(word),
            strokeWidth: 2,
            strokeDasharray: edge.inferred ? '8 7' : undefined,
          })
        }))}
        <View style={[styles.node, styles.center, { left: `${((at.get(contactId)?.x ?? width / 2) / width) * 100}%`, top: `${((at.get(contactId)?.y ?? height / 2) / height) * 100}%` }]}>
          <Text style={styles.nodeText} numberOfLines={2}>{name}</Text>
        </View>
        {nodes.map((node) => {
          const point = at.get(node.id)
          if (!point) return null
          return (
            <Pressable key={node.id} onPress={() => onOpen(node.id)} style={[styles.node, node.inferred && styles.suggested, { left: `${(point.x / width) * 100}%`, top: `${(point.y / height) * 100}%`, borderColor: colorFor(node.role) }]}>
              <Text style={styles.nodeText} numberOfLines={2}>{node.name}</Text>
              <Text style={[styles.nodeRole, { color: colorFor(node.role) }]} numberOfLines={2}>{node.role}{node.inferred ? ' · suggested' : ''}</Text>
            </Pressable>
          )
        })}
      </View>
      <Text style={styles.meta}>Older generations sit above. A dashed line is a suggestion.</Text>
    </View>
  )
}

function insertFocus(people: { id: string }[], contactId: string) {
  const mid = Math.ceil(people.length / 2)
  return [...people.slice(0, mid).map((person) => person.id), contactId, ...people.slice(mid).map((person) => person.id)]
}

function directEdge(edges: Edge[], contactId: string, otherId: string) {
  const matches = edges.filter((edge) => (edge.from === contactId && edge.to === otherId) || (edge.to === contactId && edge.from === otherId))
  return matches.sort((left, right) => rank(roleOf(left, contactId)) - rank(roleOf(right, contactId)))[0]
}

function roleOf(edge: Edge, contactId: string) {
  if (edge.from === contactId) return edge.reciprocal || inverse[edge.type.toLowerCase()] || edge.type
  if (edge.to === contactId) return edge.type
  const back = edge.reciprocal || inverse[edge.type.toLowerCase()] || edge.type
  return back.toLowerCase() === edge.type.toLowerCase() ? edge.type : `${edge.type} / ${back}`
}

function rank(role: string) {
  const band = generation[role.toLowerCase()]
  return band == null ? 20 : Math.abs(band)
}

function hash(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

const styles = StyleSheet.create({
  section: { fontFamily: font, fontSize: 13, color: theme.muted, marginBottom: 8, letterSpacing: 0.4 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 13 },
  link: { fontFamily: font, color: theme.text, fontSize: 15, marginBottom: 6 },
  reasons: { gap: 4, marginTop: 8 },
  graph: { position: 'relative' },
  node: { position: 'absolute', width: 108, marginLeft: -54, marginTop: -28, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, alignItems: 'center' },
  center: { borderColor: theme.text, borderWidth: 2 },
  suggested: { borderStyle: 'dashed' },
  nodeText: { fontFamily: font, color: theme.text, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  nodeRole: { fontFamily: font, fontSize: 11, textAlign: 'center' },
})
