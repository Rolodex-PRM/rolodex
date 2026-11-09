import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, type Contact } from './api'
import { useAuth } from './auth'
import { Icon } from './icons'
import { titleRelationship } from './people'
import { font, theme } from './theme'

type Category = 'family' | 'friend' | 'work' | 'other'
type LayoutMode = 'people' | 'household' | 'organization'

type Person = {
  id: string
  name: string
  initials: string
  lastName: string
  organizationName: string | null
  title: string | null
  hasPhoto: boolean
  degree: number
  followUpFrequency: string | null
  lastInteractionAt: string | null
}
type Edge = {
  id: string
  from: string
  to: string
  type: string
  reciprocal: string | null
  category: Category
  inferred: boolean
  description: string | null
  interactions: number
}
type Group = { id: string; name: string; memberIds: string[] }
type Graph = { people: Person[]; edges: Edge[]; organizations: Group[]; households: Group[]; clusters: { id: string; kind: string; name: string; memberIds: string[]; size: number }[] }
type Body = {
  id: string
  name: string
  initials: string
  kind: 'person' | 'hub'
  x: number
  y: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  degree: number
  category: Category
  group: number
  overdue: boolean
  hubId: string | null
}
type Bond = { id: string; source: Body; target: Body; type: string; reciprocal: string | null; category: Category; interactions: number; spoke: boolean }
type Camera = { x: number; y: number; k: number }
type Frame = { camera: Camera; points: { id: string; x: number; y: number }[] }

const categoryPalette: Record<Category, string> = {
  family: '#e7a394',
  friend: '#e3c56e',
  work: '#8ebde0',
  other: '#a9c7a0',
}
const overdueGlow = '#ff5c5c'
const empty: Graph = { people: [], edges: [], organizations: [], households: [], clusters: [] }

export function NetworkExplorer({
  height = 720,
  focusId,
  embedded = false,
}: {
  height?: number
  /** Center and highlight this person; when set, show their neighborhood only. */
  focusId?: string
  /** Compact chrome for embedding in a contact panel. */
  embedded?: boolean
}) {
  const { workspace, session } = useAuth()
  const router = useRouter()
  const [graph, setGraph] = useState<Graph | null>(null)
  const [labels, setLabels] = useState(true)
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('people')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(focusId ?? null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Contact | null>(null)
  const [orgs, setOrgs] = useState<{ id: string; name: string; title: string | null }[]>([])
  const [lastAt, setLastAt] = useState<string | null>(null)
  const [past, setPast] = useState<Frame[]>([])
  const [future, setFuture] = useState<Frame[]>([])
  const bodies = useRef<Body[]>([])
  const bonds = useRef<Bond[]>([])
  const camera = useRef<Camera>({ x: 0, y: 0, k: 1 })
  const alpha = useRef(1)
  const alphaTarget = useRef(0.05)
  const origin = useRef({ x: 480, y: 320 })
  const drag = useRef<{ id?: string; sx: number; sy: number; moved: boolean; before: Frame | null } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const overCard = useRef(false)
  const hoverRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const labelsRef = useRef(true)
  const layoutRef = useRef<LayoutMode>('people')
  const overdueRef = useRef(false)
  const drawRef = useRef<() => void>(() => {})
  const rebuildRef = useRef<() => void>(() => {})
  const cache = useRef(new Map<string, Contact>())
  const orgCache = useRef(new Map<string, { id: string; name: string; title: string | null }[]>())

  useEffect(() => {
    if (!workspace) return
    api<Graph>(`/api/workspaces/${workspace.id}/network/graph`)
      .then((raw) => setGraph(focusId ? egoNeighborhood(raw, focusId) : raw))
      .catch(() => setGraph(empty))
  }, [workspace, focusId])

  const selfId = useMemo(() => {
    const name = session?.displayName.trim().toLowerCase()
    if (!name || !graph) return null
    const people = graph.people
    return people.find((person) => person.name.trim().toLowerCase() === name)?.id
      ?? people.find((person) => person.name.trim().toLowerCase().startsWith(`${name} `))?.id
      ?? null
  }, [graph, session])

  const matches = (graph?.people ?? []).filter((person) => query.trim() && person.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6)
  hoverRef.current = hoverId
  selectedRef.current = selected
  labelsRef.current = labels
  layoutRef.current = layoutMode
  overdueRef.current = overdueOnly

  function screenOf(point: { x: number; y: number }) {
    return { x: point.x * camera.current.k + camera.current.x, y: point.y * camera.current.k + camera.current.y }
  }

  function worldAt(event: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    return { sx, sy, x: (sx - camera.current.x) / camera.current.k, y: (sy - camera.current.y) / camera.current.k }
  }

  function hit(point: { x: number; y: number }) {
    for (let index = bodies.current.length - 1; index >= 0; index -= 1) {
      const body = bodies.current[index]!
      if (Math.hypot(point.x - body.x, point.y - body.y) <= radiusOf(body) + 8) return body
    }
    return null
  }

  function capture(): Frame {
    return {
      camera: { ...camera.current },
      points: bodies.current.map((body) => ({ id: body.id, x: body.x, y: body.y })),
    }
  }

  function applyFrame(frame: Frame) {
    const byId = new Map(frame.points.map((point) => [point.id, point]))
    for (const body of bodies.current) {
      const point = byId.get(body.id)
      if (!point) continue
      body.x = point.x
      body.y = point.y
      body.vx = 0
      body.vy = 0
      body.fx = null
      body.fy = null
    }
    camera.current = { ...frame.camera }
    alpha.current = 0.3
    alphaTarget.current = 0.05
  }

  function undo() {
    const frame = past[past.length - 1]
    if (!frame) return
    setPast((items) => items.slice(0, -1))
    setFuture((items) => [...items, capture()])
    applyFrame(frame)
  }

  function redo() {
    const frame = future[future.length - 1]
    if (!frame) return
    setFuture((items) => items.slice(0, -1))
    setPast((items) => [...items, capture()])
    applyFrame(frame)
  }

  function restart() {
    setLayoutMode('people')
    setOverdueOnly(false)
    setMenuOpen(false)
    setSelected(focusId ?? null)
    setHoverId(null)
    setPast([])
    setFuture([])
    setQuery('')
    layoutRef.current = 'people'
    overdueRef.current = false
    const frame = canvasRef.current
    if (frame) {
      origin.current = { x: frame.clientWidth / 2, y: (frame.clientHeight || height) / 2 }
      camera.current = { x: 0, y: 0, k: 1 }
    }
    rebuildRef.current()
    if (focusId) {
      selectedRef.current = focusId
      const body = bodies.current.find((item) => item.id === focusId)
      if (body && frame) {
        const k = embedded ? 1.15 : 1
        camera.current = { k, x: frame.clientWidth / 2 - body.x * k, y: frame.clientHeight / 2 - body.y * k }
      }
    }
    alpha.current = 1
    alphaTarget.current = 0.05
  }

  function chooseLayout(mode: LayoutMode) {
    setMenuOpen(false)
    setLayoutMode((current) => (current === mode ? 'people' : mode))
  }

  function chooseOverdue() {
    setMenuOpen(false)
    setOverdueOnly((value) => !value)
  }

  function focusPerson(id: string) {
    const body = bodies.current.find((item) => item.id === id)
    const frame = canvasRef.current
    if (!body || !frame) return
    setSelected(id)
    setQuery('')
    setMenuOpen(false)
    const k = camera.current.k
    camera.current = { k, x: frame.clientWidth / 2 - body.x * k, y: frame.clientHeight / 2 - body.y * k }
    alpha.current = Math.max(alpha.current, 0.4)
  }

  function placeCard() {
    const node = cardRef.current
    const frame = canvasRef.current
    const body = bodies.current.find((item) => item.id === hoverRef.current)
    if (!node || !frame || !body) return
    const point = screenOf(body)
    const cardW = 304
    const cardH = Math.max(node.offsetHeight, 200)
    const radius = radiusOf(body) * camera.current.k
    const gap = radius + 18
    const margin = 12
    const topLimit = embedded ? 44 : 58
    const maxLeft = Math.max(margin, frame.clientWidth - cardW - margin)
    const maxTop = Math.max(topLimit, frame.clientHeight - cardH - margin)
    const clearOfNode = (left: number, top: number) => {
      const nearestX = clamp(point.x, left, left + cardW)
      const nearestY = clamp(point.y, top, top + cardH)
      return Math.hypot(nearestX - point.x, nearestY - point.y) >= gap - 2
    }
    const onStage = (left: number, top: number) => left >= margin && top >= topLimit && left <= maxLeft && top <= maxTop
    const sideTop = clamp(point.y - 28, topLimit, maxTop)
    const candidates = [
      { left: point.x + gap, top: sideTop },
      { left: point.x - gap - cardW, top: sideTop },
      { left: clamp(point.x - cardW / 2, margin, maxLeft), top: point.y + gap },
      { left: clamp(point.x - cardW / 2, margin, maxLeft), top: point.y - gap - cardH },
    ]
    const chosen = candidates.find((slot) => onStage(slot.left, slot.top) && clearOfNode(slot.left, slot.top))
      ?? candidates.find((slot) => clearOfNode(slot.left, slot.top))
      ?? candidates[0]!
    let left = clamp(chosen.left, margin, maxLeft)
    let top = clamp(chosen.top, topLimit, maxTop)
    if (!clearOfNode(left, top)) {
      const below = point.y + gap
      const above = point.y - gap - cardH
      top = below <= maxTop ? below : clamp(above, topLimit, maxTop)
      left = clamp(point.x - cardW / 2, margin, maxLeft)
    }
    node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  function draw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const width = canvas.clientWidth
    const heightPx = canvas.clientHeight
    const ratio = window.devicePixelRatio || 1
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(heightPx * ratio)) {
      canvas.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = Math.max(1, Math.floor(heightPx * ratio))
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const colors = readColors()
    context.clearRect(0, 0, width, heightPx)
    context.fillStyle = colors.surface
    context.fillRect(0, 0, width, heightPx)
    const active = selectedRef.current
    const near = new Set<string>()
    if (active) {
      near.add(active)
      for (const bond of bonds.current) {
        if (bond.source.id === active) near.add(bond.target.id)
        if (bond.target.id === active) near.add(bond.source.id)
      }
    }
    context.lineCap = 'round'
    const showOverdue = overdueRef.current
    for (const bond of bonds.current) {
      const from = screenOf(bond.source)
      const to = screenOf(bond.target)
      const hot = showOverdue && (bond.source.overdue || bond.target.overdue)
      const faded = Boolean(active && bond.source.id !== active && bond.target.id !== active) || (showOverdue && !hot)
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      if (hot && !faded) {
        context.strokeStyle = overdueGlow
        context.shadowColor = overdueGlow
        context.shadowBlur = 14
        context.globalAlpha = 0.9
        context.lineWidth = edgeWidth(bond.interactions) + 1.4
      } else {
        context.shadowBlur = 0
        context.strokeStyle = faded ? colors.faint : bond.spoke ? categoryPalette[bond.category] : categoryPalette[bond.category]
        context.globalAlpha = faded ? 0.1 : bond.spoke ? 0.7 : 0.45
        context.lineWidth = edgeWidth(bond.interactions) * (bond.spoke ? 1.15 : 0.9)
      }
      context.stroke()
      context.shadowBlur = 0
    }
    context.globalAlpha = 1
    const boxes: { x: number; y: number; w: number; h: number }[] = []
    const placed: Body[] = []
    for (const body of bodies.current) {
      const point = screenOf(body)
      const radius = radiusOf(body) * camera.current.k
      const hot = showOverdue && body.overdue
      const faded = Boolean(active && !near.has(body.id)) || (showOverdue && !hot && body.kind === 'person')
      context.globalAlpha = faded ? 0.22 : 1
      context.beginPath()
      if (body.kind === 'hub') roundRect(context, point.x - radius, point.y - radius * 0.78, radius * 2, radius * 1.56, 10)
      else context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fillStyle = colors.surface
      context.fill()
      if (hot && !faded) {
        context.shadowColor = overdueGlow
        context.shadowBlur = 18
        context.strokeStyle = overdueGlow
        context.lineWidth = 2.8
      } else {
        context.shadowBlur = 0
        context.lineWidth = body.id === active || body.id === hoverRef.current ? 2.4 : body.kind === 'hub' ? 1.8 : 1.4
        context.strokeStyle = body.id === active ? colors.text : categoryPalette[body.category]
      }
      context.stroke()
      context.shadowBlur = 0
      context.fillStyle = colors.text
      context.font = `600 ${Math.max(11, radius * (body.kind === 'hub' ? 0.42 : 0.62))}px ${font}`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(body.kind === 'hub' ? body.name.slice(0, 12) : body.initials, point.x, point.y + 0.5)
      placed.push(body)
    }
    if (labelsRef.current) {
      context.textBaseline = 'middle'
      context.font = `500 12px ${font}`
      const labeled = [...placed].filter((body) => body.kind === 'person').sort((left, right) => Number(right.id === hoverRef.current) - Number(left.id === hoverRef.current) || Number(right.id === active) - Number(left.id === active) || right.degree - left.degree)
      for (const body of labeled) {
        const point = screenOf(body)
        const radius = radiusOf(body) * camera.current.k
        const priority = body.id === active || body.id === hoverRef.current
        const crowded = bodies.current.some((other) => other.id !== body.id && Math.hypot(other.x - body.x, other.y - body.y) < 36)
        if (crowded && !priority) continue
        const textWidth = Math.max(48, context.measureText(body.name).width)
        const labelY = point.y + radius + 12
        const box = { x: point.x - textWidth / 2 - 8, y: labelY - 10, w: textWidth + 16, h: 20 }
        const blocked = boxes.some((item) => item.x < box.x + box.w && item.x + item.w > box.x && item.y < box.y + box.h && item.y + item.h > box.y)
        if (blocked && !priority) continue
        context.globalAlpha = active && !near.has(body.id) ? 0.28 : 1
        context.fillStyle = colors.text
        context.fillText(body.name, point.x, labelY)
        boxes.push(box)
      }
    }
    context.globalAlpha = 1
    placeCard()
  }
  drawRef.current = draw

  useEffect(() => {
    if (!graph) return
    let stopped = false
    let frameId = 0
    const begin = () => {
      if (stopped) return
      const frame = canvasRef.current
      if (!frame || frame.clientWidth < 40) {
        frameId = requestAnimationFrame(begin)
        return
      }
      origin.current = { x: frame.clientWidth / 2, y: (frame.clientHeight || height) / 2 }
      camera.current = { x: 0, y: 0, k: 1 }
      rebuildRef.current()
      if (focusId) {
        selectedRef.current = focusId
        setSelected(focusId)
        const body = bodies.current.find((item) => item.id === focusId)
        if (body) {
          const k = embedded ? 1.15 : 1
          camera.current = { k, x: frame.clientWidth / 2 - body.x * k, y: frame.clientHeight / 2 - body.y * k }
        }
      }
      const loop = () => {
        if (stopped) return
        step(bodies.current, bonds.current, origin.current, alpha, alphaTarget, layoutRef.current)
        drawRef.current()
        frameId = requestAnimationFrame(loop)
      }
      frameId = requestAnimationFrame(loop)
    }
    begin()
    return () => {
      stopped = true
      cancelAnimationFrame(frameId)
    }
  }, [graph, height, focusId, embedded])

  function rebuildScene(preserve = true) {
    if (!graph) return
    const previous = preserve ? new Map(bodies.current.map((body) => [body.id, { x: body.x, y: body.y }])) : new Map<string, { x: number; y: number }>()
    const mode = layoutRef.current
    const hubs = mode === 'household' ? householdHubs(graph) : mode === 'organization' ? organizationHubs(graph) : []
    const people = graph.people.map((person) => {
      const cadence = person.followUpFrequency ? Number(person.followUpFrequency) : null
      const since = person.lastInteractionAt ? Math.floor((Date.now() - new Date(person.lastInteractionAt).getTime()) / 86_400_000) : null
      const overdue = Boolean(cadence && !Number.isNaN(cadence) && (since === null || since >= cadence))
      const mine = graph.edges.filter((edge) => !edge.inferred && (edge.from === person.id || edge.to === person.id))
      const category = mine.sort((left, right) => right.interactions - left.interactions)[0]?.category ?? 'other'
      const prior = previous.get(person.id)
      return {
        id: person.id,
        name: person.name,
        initials: person.initials,
        kind: 'person' as const,
        x: prior?.x ?? 0,
        y: prior?.y ?? 0,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        degree: mine.length,
        category,
        group: 0,
        overdue,
        hubId: null as string | null,
      }
    })
    const byId = new Map(people.map((body) => [body.id, body]))
    const hubBodies: Body[] = hubs.map((hub, index) => {
      const members = hub.memberIds.map((id) => byId.get(id)).filter(Boolean) as Body[]
      const prior = previous.get(hub.id)
      const cx = prior?.x ?? (members.length ? members.reduce((sum, body) => sum + body.x, 0) / members.length : origin.current.x + Math.cos(index) * 160)
      const cy = prior?.y ?? (members.length ? members.reduce((sum, body) => sum + body.y, 0) / members.length : origin.current.y + Math.sin(index) * 160)
      for (const member of members) member.hubId = hub.id
      return {
        id: hub.id,
        name: hub.name,
        initials: initialsOf(hub.name),
        kind: 'hub' as const,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        degree: members.length,
        category: mode === 'organization' ? 'work' as Category : 'family' as Category,
        group: index,
        overdue: members.some((member) => member.overdue),
        hubId: null,
      }
    })
    for (const hub of hubBodies) {
      const members = people.filter((person) => person.hubId === hub.id)
      members.forEach((member, index) => {
        if (previous.has(member.id)) return
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(members.length, 1)
        const ring = 54 + Math.sqrt(members.length) * 10
        member.x = hub.x + Math.cos(angle) * ring
        member.y = hub.y + Math.sin(angle) * ring
      })
    }
    const next = [...people, ...hubBodies]
    const hubById = new Map(hubBodies.map((hub) => [hub.id, hub]))
    const explicit = graph.edges.filter((edge) => !edge.inferred && byId.has(edge.from) && byId.has(edge.to))
    const nextBonds: Bond[] = []
    if (mode === 'people') {
      for (const edge of explicit) {
        const source = byId.get(edge.from)
        const target = byId.get(edge.to)
        if (!source || !target) continue
        nextBonds.push({ id: edge.id, source, target, type: edge.type, reciprocal: edge.reciprocal, category: edge.category, interactions: edge.interactions ?? 0, spoke: false })
      }
      assignGroups(people, nextBonds)
      if (!previous.size) scatter(people, origin.current.x, origin.current.y)
    } else {
      if (!previous.size) {
        hubBodies.forEach((hub, index) => {
          const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(hubBodies.length, 1)
          const orbit = hubBodies.length === 1 ? 0 : 210
          hub.x = origin.current.x + Math.cos(angle) * orbit
          hub.y = origin.current.y + Math.sin(angle) * orbit
          const members = people.filter((person) => person.hubId === hub.id)
          members.forEach((member, memberIndex) => {
            const turn = -Math.PI / 2 + (memberIndex * 2 * Math.PI) / Math.max(members.length, 1)
            const ring = 58 + Math.sqrt(members.length) * 12
            member.x = hub.x + Math.cos(turn) * ring
            member.y = hub.y + Math.sin(turn) * ring
          })
        })
        people.filter((person) => !person.hubId).forEach((person, index) => {
          const angle = (index / Math.max(people.length, 1)) * Math.PI * 2
          person.x = origin.current.x + Math.cos(angle) * 320
          person.y = origin.current.y + Math.sin(angle) * 240
        })
      }
      for (const hub of hubs) {
        const hubBody = hubById.get(hub.id)
        if (!hubBody) continue
        for (const memberId of hub.memberIds) {
          const member = byId.get(memberId)
          if (!member) continue
          nextBonds.push({ id: `spoke:${hub.id}:${memberId}`, source: hubBody, target: member, type: mode === 'organization' ? 'member' : 'household', reciprocal: mode === 'organization' ? 'member' : 'household', category: hubBody.category, interactions: 1, spoke: true })
        }
      }
      for (const edge of explicit) {
        const source = byId.get(edge.from)
        const target = byId.get(edge.to)
        if (!source || !target) continue
        if (source.hubId && source.hubId === target.hubId) {
          nextBonds.push({ id: edge.id, source, target, type: edge.type, reciprocal: edge.reciprocal, category: edge.category, interactions: edge.interactions ?? 0, spoke: false })
        } else if (source.hubId && target.hubId && source.hubId !== target.hubId) {
          const left = hubById.get(source.hubId)
          const right = hubById.get(target.hubId)
          if (!left || !right) continue
          if (nextBonds.some((bond) => bond.id === `bridge:${left.id}:${right.id}` || bond.id === `bridge:${right.id}:${left.id}`)) continue
          nextBonds.push({ id: `bridge:${left.id}:${right.id}`, source: left, target: right, type: edge.type, reciprocal: edge.reciprocal, category: edge.category, interactions: edge.interactions ?? 0, spoke: false })
        }
      }
      for (const body of next) {
        if (body.kind === 'hub') body.group = hubBodies.findIndex((hub) => hub.id === body.id)
        else body.group = body.hubId ? hubBodies.findIndex((hub) => hub.id === body.hubId) : hubBodies.length + 1
      }
    }
    bodies.current = next
    bonds.current = nextBonds
    alpha.current = Math.max(alpha.current, 0.85)
    alphaTarget.current = 0.05
  }
  rebuildRef.current = () => rebuildScene(true)

  useEffect(() => {
    if (!graph) return
    rebuildScene(true)
  }, [layoutMode, overdueOnly, graph])

  useEffect(() => {
    if (!workspace || !hoverId) {
      setDetail(null)
      setOrgs([])
      setLastAt(null)
      return
    }
    const cached = cache.current.get(hoverId)
    const cachedOrgs = orgCache.current.get(hoverId)
    if (cached) setDetail(cached)
    else {
      setDetail(null)
      api<Contact>(`/api/workspaces/${workspace.id}/contacts/${hoverId}`)
        .then((contact) => {
          cache.current.set(hoverId, contact)
          setDetail((current) => (hoverRef.current === hoverId ? contact : current))
        })
        .catch(() => setDetail(null))
    }
    if (cachedOrgs) setOrgs(cachedOrgs)
    else {
      setOrgs([])
      api<{ id: string; name: string; title: string | null }[]>(`/api/workspaces/${workspace.id}/contacts/${hoverId}/organizations`)
        .then((rows) => {
          orgCache.current.set(hoverId, rows)
          setOrgs(hoverRef.current === hoverId ? rows : [])
        })
        .catch(() => setOrgs([]))
    }
    api<{ id: string; occurredAt: string }[]>(`/api/workspaces/${workspace.id}/activities?contactId=${hoverId}`)
      .then((rows) => setLastAt(hoverRef.current === hoverId ? rows[0]?.occurredAt ?? null : null))
      .catch(() => setLastAt(null))
  }, [workspace, hoverId])

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      const next = clamp(camera.current.k * (event.deltaY < 0 ? 1.08 : 0.92), 0.25, 2.8)
      const wx = (sx - camera.current.x) / camera.current.k
      const wy = (sy - camera.current.y) / camera.current.k
      camera.current = { k: next, x: sx - wx * next, y: sy - wy * next }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [graph])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === 'Escape') {
        setSelected(null)
        setHoverId(null)
        setMenuOpen(false)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
      if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const hovered = bodies.current.find((body) => body.id === hoverId) ?? graph?.people.find((person) => person.id === hoverId)
  const person = graph?.people.find((item) => item.id === hoverId)
  const phone = detail?.methods.find((method) => method.kind === 'phone')?.value ?? detail?.primaryPhone ?? null
  const email = detail?.methods.find((method) => method.kind === 'email')?.value ?? detail?.primaryEmail ?? null
  const organization = orgs.map((org) => org.name).filter(Boolean).join(', ') || detail?.organizationName || person?.organizationName || null
  const title = detail?.title || person?.title || null
  const roleLine = [title, organization].filter(Boolean).join(' · ')
  const relationship = relationshipToSelf(hoverId, selfId, bonds.current, detail)

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.native}>
        {(graph?.people ?? []).map((person) => (
          <Pressable key={person.id} onPress={() => router.push(`/contacts/${person.id}`)}>
            <Text style={styles.nativeLink}>{person.name}</Text>
          </Pressable>
        ))}
      </View>
    )
  }

  return (
    <View style={[styles.stage, embedded ? styles.stageEmbedded : null, { height }]}>
      {createElement('canvas', {
        ref: canvasRef,
        onPointerDown: (event: PointerEvent & { currentTarget: HTMLCanvasElement }) => {
          const point = worldAt(event)
          const body = hit(point)
          drag.current = { id: body?.id, sx: point.sx, sy: point.sy, moved: false, before: body ? capture() : null }
          if (body) {
            body.fx = body.x
            body.fy = body.y
            alphaTarget.current = 0.32
            alpha.current = Math.max(alpha.current, 0.45)
            setHoverId(null)
          }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        },
        onPointerMove: (event: PointerEvent) => {
          const point = worldAt(event)
          const current = drag.current
          if (current) {
            if (Math.hypot(point.sx - current.sx, point.sy - current.sy) > 3) current.moved = true
            if (current.id) {
              const body = bodies.current.find((item) => item.id === current.id)
              if (body) {
                body.fx = point.x
                body.fy = point.y
                alpha.current = Math.max(alpha.current, 0.35)
              }
            } else {
              camera.current = { ...camera.current, x: camera.current.x + (point.sx - current.sx), y: camera.current.y + (point.sy - current.sy) }
              current.sx = point.sx
              current.sy = point.sy
            }
            return
          }
          const body = hit(point)
          const nextId = body?.kind === 'person' ? body.id : null
          if (nextId === hoverRef.current) return
          overCard.current = false
          setHoverId(nextId)
        },
        onPointerUp: (event: PointerEvent) => {
          const current = drag.current
          drag.current = null
          alphaTarget.current = 0.05
          const body = current?.id ? bodies.current.find((item) => item.id === current.id) : null
          if (body) {
            body.fx = null
            body.fy = null
          }
          if (current?.moved && current.before && current.id) {
            setPast((items) => [...items.slice(-30), current.before!])
            setFuture([])
          }
          if (current && !current.moved) {
            const point = worldAt(event)
            const next = hit(point)
            setSelected(next?.id ?? focusId ?? null)
            setMenuOpen(false)
            if (next?.kind === 'person') setHoverId(next.id)
          }
        },
        onPointerLeave: () => {
          window.setTimeout(() => {
            if (!overCard.current && !drag.current) setHoverId(null)
          }, 160)
        },
        onDoubleClick: (event: MouseEvent) => {
          const body = hit(worldAt(event))
          if (body?.kind === 'person') focusPerson(body.id)
        },
        style: { width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' },
      })}
      <View style={[styles.chrome, embedded ? styles.chromeEmbedded : null]} pointerEvents="box-none">
        {embedded ? null : (
          <View style={styles.leftChrome}>
            <View style={styles.searchWrap}>
              <TextInput value={query} onChangeText={setQuery} placeholder="Search people" placeholderTextColor={theme.muted} style={styles.search} />
              {matches.length ? (
                <View style={styles.results}>
                  {matches.map((person) => (
                    <Pressable key={person.id} onPress={() => focusPerson(person.id)} style={styles.result}>
                      <Text style={styles.resultText}>{person.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <View style={styles.menuWrap}>
              <Tool label="More options" icon="more" on={menuOpen || layoutMode !== 'people' || overdueOnly} onPress={() => setMenuOpen((value) => !value)} />
              {menuOpen ? (
                <View style={styles.menu}>
                  <MenuRow label="Group by household" on={layoutMode === 'household'} onPress={() => chooseLayout('household')} />
                  <MenuRow label="Group by organization" on={layoutMode === 'organization'} onPress={() => chooseLayout('organization')} />
                  <MenuRow label="Reach out due" on={overdueOnly} onPress={chooseOverdue} />
                </View>
              ) : null}
            </View>
          </View>
        )}
        <View style={[styles.tools, embedded ? styles.toolsEmbedded : null]}>
          {embedded ? null : (
            <>
              <Tool label="Undo" icon="undo" onPress={undo} />
              <Tool label="Redo" icon="redo" onPress={redo} />
            </>
          )}
          <Tool label="Reset graph" icon="reset" onPress={restart} />
          <Tool label={labels ? 'Hide labels' : 'Show labels'} icon="eye" on={labels} onPress={() => setLabels((value) => !value)} />
        </View>
      </View>
      <View style={[styles.legend, embedded ? styles.legendEmbedded : null]} pointerEvents="none">
        {(Object.keys(categoryPalette) as Category[]).map((item) => (
          <View key={item} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: categoryPalette[item] }]} />
            <Text style={styles.legendText}>{titleRelationship(item)}</Text>
          </View>
        ))}
        {overdueOnly ? (
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: overdueGlow }]} />
            <Text style={styles.legendText}>Reach out due</Text>
          </View>
        ) : null}
      </View>
      {hoverId && hovered ? createElement(
        'div',
        {
          ref: cardRef,
          onMouseEnter: () => { overCard.current = true },
          onMouseLeave: () => { overCard.current = false; setHoverId(null) },
          style: cardShell,
        },
        <View>
          <View style={styles.identity}>
            <View style={[styles.avatar, { borderColor: categoryPalette[('category' in hovered ? hovered.category : 'other') as Category] }]}>
              <Text style={styles.avatarText}>{hovered.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{detail?.displayName ?? hovered.name}</Text>
              <Text style={[styles.relationship, { color: categoryPalette[('category' in hovered ? hovered.category : 'other') as Category] }]}>{relationship}</Text>
            </View>
          </View>
          {roleLine ? <Text style={styles.role}>{roleLine}</Text> : null}
          <View style={styles.facts}>
            <Fact label="Phone" value={detail ? phone || 'No phone' : 'Loading'} />
            <Fact label="Email" value={detail ? email || 'No email' : 'Loading'} />
            <Fact label="Last interaction" value={detail || lastAt ? formatWhen(detail?.lastInteractionAt || lastAt) : 'Loading'} />
          </View>
          <Pressable onPress={() => router.push(`/contacts/${hoverId}`)} style={styles.open}>
            <Text style={styles.openText}>Open contact</Text>
          </Pressable>
        </View>,
      ) : null}
    </View>
  )
}

function Tool({ label, icon, on, onPress }: { label: string; icon: 'undo' | 'redo' | 'reset' | 'eye' | 'more'; on?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[styles.tool, on ? styles.toolOn : null]}>
      <Icon name={icon} color={theme.text} size={16} />
    </Pressable>
  )
}

function MenuRow({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={[styles.menuRow, on ? styles.menuRowOn : null]}>
      <Text style={[styles.menuText, on ? styles.menuTextOn : null]}>{label}</Text>
    </Pressable>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>{value}</Text>
    </View>
  )
}

function relationshipToSelf(personId: string | null, selfId: string | null, bonds: Bond[], detail: Contact | null) {
  if (!personId) return ''
  if (selfId && personId === selfId) return 'This is you'
  const bond = selfId ? bonds.find((item) => (item.source.id === personId && item.target.id === selfId) || (item.target.id === personId && item.source.id === selfId)) : undefined
  if (bond && selfId) {
    const type = bond.source.id === personId ? bond.type : bond.reciprocal || bond.type
    return `Your ${titleRelationship(type).toLowerCase()}`
  }
  if (detail?.userRelationship) return `Your ${titleRelationship(detail.userRelationship).toLowerCase()}`
  return 'No direct relationship'
}

function scatter(bodies: Body[], cx: number, cy: number) {
  const grouped = new Map<number, Body[]>()
  for (const body of bodies) {
    const list = grouped.get(body.group) ?? []
    list.push(body)
    grouped.set(body.group, list)
  }
  const communities = [...grouped.values()].filter((list) => list.length > 1)
  const singles = [...grouped.values()].filter((list) => list.length === 1).map((list) => list[0]!)
  communities.forEach((members, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(communities.length, 1)
    const orbit = communities.length === 1 ? 0 : 170
    const gx = cx + Math.cos(angle) * orbit
    const gy = cy + Math.sin(angle) * orbit
    members.forEach((body, member) => {
      const turn = (member / members.length) * Math.PI * 2
      const ring = 16 + Math.sqrt(members.length) * 7 * (0.45 + (member % 4) * 0.12)
      body.x = gx + Math.cos(turn) * ring
      body.y = gy + Math.sin(turn) * ring
      body.vx = 0
      body.vy = 0
      body.fx = null
      body.fy = null
    })
  })
  singles.forEach((body, index) => {
    const angle = (index / Math.max(singles.length, 1)) * Math.PI * 2
    body.x = cx + Math.cos(angle) * 300
    body.y = cy + Math.sin(angle) * 230
    body.vx = 0
    body.vy = 0
    body.fx = null
    body.fy = null
  })
}

function assignGroups(bodies: Body[], bonds: Bond[]) {
  const neighbors = new Map<string, string[]>()
  for (const body of bodies) neighbors.set(body.id, [])
  for (const bond of bonds) {
    neighbors.get(bond.source.id)?.push(bond.target.id)
    neighbors.get(bond.target.id)?.push(bond.source.id)
  }
  const reaches = (from: string, to: string, skipA: string, skipB: string) => {
    const seen = new Set<string>([from])
    const queue = [from]
    while (queue.length) {
      const current = queue.pop()!
      if (current === to) return true
      for (const next of neighbors.get(current) ?? []) {
        const skipped = (current === skipA && next === skipB) || (current === skipB && next === skipA)
        if (skipped || seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    return false
  }
  const pair = (left: string, right: string) => (left < right ? `${left}|${right}` : `${right}|${left}`)
  const bridges = new Set<string>()
  for (const bond of bonds) {
    if (!reaches(bond.source.id, bond.target.id, bond.source.id, bond.target.id)) bridges.add(pair(bond.source.id, bond.target.id))
  }
  const parent = new Map(bodies.map((body) => [body.id, body.id]))
  const find = (id: string): string => {
    const current = parent.get(id) ?? id
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  for (const bond of bonds) {
    if (bridges.has(pair(bond.source.id, bond.target.id))) continue
    const left = find(bond.source.id)
    const right = find(bond.target.id)
    if (left !== right) parent.set(left, right)
  }
  const groupOf = new Map<string, number>()
  let nextGroup = 0
  for (const body of bodies) {
    const root = body.degree === 0 ? `solo:${body.id}` : find(body.id)
    if (!groupOf.has(root)) groupOf.set(root, nextGroup++)
    body.group = groupOf.get(root) ?? 0
  }
}

function step(bodies: Body[], bonds: Bond[], origin: { x: number; y: number }, alpha: { current: number }, alphaTarget: { current: number }, mode: LayoutMode) {
  const cooling = alpha.current
  const tree = mode !== 'people'
  for (const bond of bonds) {
    let dx = bond.target.x - bond.source.x
    let dy = bond.target.y - bond.source.y
    const dist = Math.hypot(dx, dy) || 1
    const sourceDegree = Math.max(bond.source.degree, 1)
    const targetDegree = Math.max(bond.target.degree, 1)
    const bias = bond.spoke ? 0.18 : sourceDegree / (sourceDegree + targetDegree)
    const bridge = !bond.spoke && bond.source.group !== bond.target.group
    const strength = bond.spoke ? 2.8 : bridge ? (tree ? 0.55 : 0.42) : tree ? 1.35 : 2.1 + Math.min(bond.interactions, 8) * 0.08
    const desired = bond.spoke ? 78 : bridge ? (tree ? 220 : 150) : tree ? 42 : 32 - Math.min(bond.interactions, 8) * 0.8
    const delta = ((dist - desired) / dist) * cooling * strength
    dx *= delta
    dy *= delta
    bond.source.vx += dx * bias
    bond.source.vy += dy * bias
    bond.target.vx -= dx * (1 - bias)
    bond.target.vy -= dy * (1 - bias)
  }
  for (let left = 0; left < bodies.length; left += 1) {
    for (let right = left + 1; right < bodies.length; right += 1) {
      const a = bodies[left]!
      const b = bodies[right]!
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist2 = dx * dx + dy * dy
      if (dist2 < 1) {
        dx = 1
        dy = 0
        dist2 = 1
      }
      const apart = a.group !== b.group
      const bothHub = a.kind === 'hub' && b.kind === 'hub'
      const charge = bothHub ? -55 : apart ? (tree ? -36 : -28) : tree ? -7 : -4
      const reach = bothHub ? 560 * 560 : apart ? 460 * 460 : 180 * 180
      if (dist2 < reach) {
        const weight = (charge * cooling) / dist2
        a.vx += dx * weight
        a.vy += dy * weight
        b.vx -= dx * weight
        b.vy -= dy * weight
      }
    }
  }
  for (const body of bodies) {
    if (body.kind === 'hub') {
      body.vx += (origin.x - body.x) * 0.01 * cooling
      body.vy += (origin.y - body.y) * 0.01 * cooling
    } else if (body.degree === 0 || !body.hubId) {
      body.vx += (origin.x - body.x) * 0.008 * cooling
      body.vy += (origin.y - body.y) * 0.008 * cooling
    }
    body.vx += (Math.random() - 0.5) * 0.08 * cooling
    body.vy += (Math.random() - 0.5) * 0.08 * cooling
    if (body.fx != null && body.fy != null) {
      body.x = body.fx
      body.y = body.fy
      body.vx = 0
      body.vy = 0
      continue
    }
    body.vx *= 0.6
    body.vy *= 0.6
    const speed = Math.hypot(body.vx, body.vy)
    if (speed > 12) {
      body.vx = (body.vx / speed) * 12
      body.vy = (body.vy / speed) * 12
    }
    body.x += body.vx
    body.y += body.vy
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (let left = 0; left < bodies.length; left += 1) {
      for (let right = left + 1; right < bodies.length; right += 1) {
        const a = bodies[left]!
        const b = bodies[right]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let dist = Math.hypot(dx, dy)
        const need = radiusOf(a) + radiusOf(b) + (a.kind === 'hub' || b.kind === 'hub' ? 10 : 5)
        if (dist >= need) continue
        if (dist < 0.1) {
          dx = 0.1
          dy = 0
          dist = 0.1
        }
        const push = (need - dist) / 2
        const ux = (dx / dist) * push
        const uy = (dy / dist) * push
        if (a.fx == null) {
          a.x -= ux
          a.y -= uy
        }
        if (b.fx == null) {
          b.x += ux
          b.y += uy
        }
      }
    }
  }
  let sx = 0
  let sy = 0
  for (const body of bodies) {
    sx += body.x
    sy += body.y
  }
  const count = bodies.length || 1
  sx = sx / count - origin.x
  sy = sy / count - origin.y
  for (const body of bodies) {
    body.x -= sx
    body.y -= sy
    if (body.fx != null && body.fy != null) {
      body.x = body.fx
      body.y = body.fy
    }
  }
  alpha.current += (alphaTarget.current - alpha.current) * 0.012
}

function radiusOf(body: { degree: number; kind?: 'person' | 'hub' }) {
  if (body.kind === 'hub') return 22 + Math.min(body.degree, 10) * 0.9
  return 10 + Math.min(body.degree, 6) * 0.35
}

function isOverdue(person: Person) {
  const cadence = person.followUpFrequency ? Number(person.followUpFrequency) : null
  if (!cadence || Number.isNaN(cadence)) return false
  if (!person.lastInteractionAt) return true
  const since = Math.floor((Date.now() - new Date(person.lastInteractionAt).getTime()) / 86_400_000)
  return since >= cadence
}

function surnameOf(person: Person) {
  const last = person.lastName.trim()
  if (last) return last
  const parts = person.name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1]! : person.name
}

function surnameLabel(members: Person[]) {
  const counts = new Map<string, number>()
  for (const person of members) {
    const name = surnameOf(person)
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'Household'
}

function householdHubs(graph: Graph) {
  const byId = new Map(graph.people.map((person) => [person.id, person]))
  const used = new Set<string>()
  const hubs: Group[] = []
  for (const home of graph.households) {
    const members = home.memberIds.map((id) => byId.get(id)).filter(Boolean) as Person[]
    if (members.length < 2) continue
    for (const person of members) used.add(person.id)
    hubs.push({ id: `household:${home.id}`, name: surnameLabel(members), memberIds: members.map((person) => person.id) })
  }
  for (const cluster of graph.clusters.filter((item) => item.kind === 'family')) {
    const members = cluster.memberIds
      .map((id) => byId.get(id))
      .filter((person): person is Person => person != null && !used.has(person.id))
    if (members.length < 2) continue
    for (const person of members) used.add(person.id)
    hubs.push({ id: `family:${cluster.id}`, name: surnameLabel(members), memberIds: members.map((person) => person.id) })
  }
  const leftover = new Map<string, Person[]>()
  for (const person of graph.people) {
    if (used.has(person.id)) continue
    const key = surnameOf(person).toLowerCase()
    if (!key) continue
    const list = leftover.get(key) ?? []
    list.push(person)
    leftover.set(key, list)
  }
  for (const [key, members] of leftover) {
    if (members.length < 2) continue
    hubs.push({ id: `surname:${key}`, name: surnameLabel(members), memberIds: members.map((person) => person.id) })
  }
  return hubs
}

function organizationHubs(graph: Graph) {
  return graph.organizations
    .map((org) => ({ ...org, memberIds: org.memberIds.filter((id) => graph.people.some((person) => person.id === id)) }))
    .filter((org) => org.memberIds.length > 0)
    .map((org) => ({ id: `org:${org.id}`, name: org.name, memberIds: org.memberIds }))
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''}`.toUpperCase() || '?'
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.moveTo(x + r, y)
  context.arcTo(x + w, y, x + w, y + h, r)
  context.arcTo(x + w, y + h, x, y + h, r)
  context.arcTo(x, y + h, x, y, r)
  context.arcTo(x, y, x + w, y, r)
  context.closePath()
}

function edgeWidth(interactions: number) {
  return 0.7 + Math.min(Math.max(interactions, 0), 8) * 0.22
}

function formatWhen(value: string | null | undefined) {
  if (!value) return 'No interactions yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No interactions yet'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function readColors() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return { surface: read('--rx-surface', '#ffffff'), text: read('--rx-text', '#1a1a1a'), faint: read('--rx-line', 'rgba(17,17,17,0.16)') }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Focus person plus everyone linked to them, and the edges among that set. */
function egoNeighborhood(graph: Graph, focusId: string): Graph {
  const keep = new Set<string>([focusId])
  for (const edge of graph.edges) {
    if (edge.from === focusId) keep.add(edge.to)
    if (edge.to === focusId) keep.add(edge.from)
  }
  const people = graph.people.filter((person) => keep.has(person.id))
  if (!people.some((person) => person.id === focusId)) return graph
  const edges = graph.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to))
  const clip = (groups: Group[]) =>
    groups
      .map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => keep.has(id)) }))
      .filter((group) => group.memberIds.length > 0)
  return {
    people,
    edges,
    organizations: clip(graph.organizations),
    households: clip(graph.households),
    clusters: graph.clusters
      .map((cluster) => ({ ...cluster, memberIds: cluster.memberIds.filter((id) => keep.has(id)), size: 0 }))
      .map((cluster) => ({ ...cluster, size: cluster.memberIds.length }))
      .filter((cluster) => cluster.memberIds.length > 0),
  }
}

const cardShell: Record<string, string | number> = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 304,
  zIndex: 5,
  padding: 16,
  borderRadius: 18,
  background: 'var(--rx-surface)',
  border: '1px solid var(--rx-border)',
  boxShadow: 'var(--rx-shadow)',
  backdropFilter: 'blur(16px)',
}

const styles = StyleSheet.create({
  stage: { borderWidth: 1, borderColor: theme.border, borderRadius: 18, overflow: 'hidden', backgroundColor: theme.surface, position: 'relative' },
  stageEmbedded: { borderRadius: 14 },
  chrome: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 3 },
  chromeEmbedded: { justifyContent: 'flex-end' },
  leftChrome: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  searchWrap: { width: 240, position: 'relative' },
  search: { borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, fontFamily: font, color: theme.text, backgroundColor: theme.surface },
  results: { marginTop: 6, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, overflow: 'hidden', boxShadow: theme.shadow },
  result: { paddingHorizontal: 14, paddingVertical: 9 },
  resultText: { fontFamily: font, color: theme.text, fontSize: 14 },
  menuWrap: { position: 'relative' },
  menu: { position: 'absolute', top: 40, left: 0, width: 220, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, paddingVertical: 6, zIndex: 8, boxShadow: theme.shadow },
  menuRow: { paddingHorizontal: 14, paddingVertical: 10 },
  menuRowOn: { backgroundColor: theme.hover },
  menuText: { fontFamily: font, color: theme.text, fontSize: 13 },
  menuTextOn: { fontWeight: '600' },
  tools: { flexDirection: 'row', gap: 6 },
  toolsEmbedded: { marginLeft: 'auto' },
  tool: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  toolOn: { backgroundColor: theme.hover },
  legend: { position: 'absolute', left: 14, bottom: 12, flexDirection: 'row', gap: 12, zIndex: 2 },
  legendEmbedded: { left: 10, bottom: 8, gap: 8 },
  legendItem: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  swatch: { width: 16, height: 3, borderRadius: 2 },
  legendText: { fontFamily: font, color: theme.muted, fontSize: 11 },
  identity: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: theme.surface },
  avatarText: { fontFamily: font, color: theme.text, fontWeight: '700', fontSize: 14 },
  name: { fontFamily: font, color: theme.text, fontSize: 17, fontWeight: '700' },
  relationship: { fontFamily: font, fontSize: 13, marginTop: 2 },
  role: { fontFamily: font, color: theme.text, fontSize: 13, marginTop: 12 },
  facts: { marginTop: 12, gap: 8 },
  fact: { gap: 1 },
  factLabel: { fontFamily: font, color: theme.muted, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  factValue: { fontFamily: font, color: theme.text, fontSize: 13 },
  open: { marginTop: 14, borderRadius: 999, backgroundColor: theme.text, alignItems: 'center', paddingVertical: 8 },
  openText: { fontFamily: font, color: theme.on, fontSize: 13, fontWeight: '600' },
  native: { gap: 8 },
  nativeLink: { fontFamily: font, color: theme.text, fontSize: 16 },
})
