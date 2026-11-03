export type KinEdge = { from: string; to: string; type: string }

const inverseOf: Record<string, string> = {
  parent: 'child',
  child: 'parent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  spouse: 'spouse',
  sibling: 'sibling',
  'aunt/uncle': 'niece/nephew',
  'niece/nephew': 'aunt/uncle',
  cousin: 'cousin',
  coworker: 'coworker',
  friend: 'friend',
  'boyfriend/girlfriend': 'boyfriend/girlfriend',
}

const rankOf: Record<string, number> = {
  spouse: 1,
  parent: 2,
  child: 2,
  sibling: 3,
  grandparent: 4,
  grandchild: 4,
  'aunt/uncle': 5,
  'niece/nephew': 5,
  cousin: 6,
  coworker: 8,
  friend: 9,
}

const edgeKey = (from: string, to: string) => `${from}\0${to}`
const pairKey = (from: string, to: string) => (from < to ? `${from}\0${to}` : `${to}\0${from}`)

export function inferRelationships(explicit: KinEdge[]): KinEdge[] {
  const known = new Map<string, string>()
  const locked = new Set<string>()
  const explicitPairs = new Set<string>()

  for (const edge of explicit) {
    const type = edge.type.trim().toLowerCase()
    if (!edge.from || !edge.to || edge.from === edge.to || !type) continue
    known.set(edgeKey(edge.from, edge.to), type)
    locked.add(edgeKey(edge.from, edge.to))
    explicitPairs.add(pairKey(edge.from, edge.to))
    const back = inverseOf[type]
    const backKey = edgeKey(edge.to, edge.from)
    if (back && !locked.has(backKey)) {
      known.set(backKey, back)
      locked.add(backKey)
    }
  }

  const setOne = (from: string, to: string, type: string) => {
    if (from === to || explicitPairs.has(pairKey(from, to))) return false
    const id = edgeKey(from, to)
    if (locked.has(id)) return false
    const current = known.get(id)
    const nextRank = rankOf[type] ?? 50
    const currentRank = current ? (rankOf[current] ?? 50) : Number.POSITIVE_INFINITY
    if (current && currentRank <= nextRank) return false
    known.set(id, type)
    return true
  }

  const link = (from: string, to: string, type: string) => {
    const back = inverseOf[type]
    if (!back) return false
    const forward = setOne(from, to, type)
    const backward = setOne(to, from, back)
    return forward || backward
  }

  const edges = () =>
    [...known.entries()].map(([id, type]) => {
      const [from, to] = id.split('\0')
      return { from: from!, to: to!, type }
    })

  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    const parents = edges().filter((edge) => edge.type === 'parent')
    for (const parent of parents) {
      for (const next of parents) {
        if (parent.to === next.from) changed = link(parent.from, next.to, 'grandparent') || changed
      }
    }
    for (const grand of edges().filter((edge) => edge.type === 'grandparent')) {
      for (const spouse of edges().filter((edge) => edge.type === 'spouse')) {
        if (grand.from === spouse.from) changed = link(spouse.to, grand.to, 'grandparent') || changed
        if (grand.from === spouse.to) changed = link(spouse.from, grand.to, 'grandparent') || changed
      }
    }
    const childrenOf = new Map<string, string[]>()
    for (const parent of parents) {
      const list = childrenOf.get(parent.from) ?? []
      list.push(parent.to)
      childrenOf.set(parent.from, list)
    }
    for (const children of childrenOf.values()) {
      for (const left of children) {
        for (const right of children) {
          if (left !== right) changed = link(left, right, 'sibling') || changed
        }
      }
    }
    for (const parent of edges().filter((edge) => edge.type === 'parent')) {
      for (const sibling of edges().filter((edge) => edge.type === 'sibling')) {
        if (parent.from === sibling.to) changed = link(sibling.from, parent.to, 'aunt/uncle') || changed
        if (parent.from === sibling.from) changed = link(sibling.to, parent.to, 'aunt/uncle') || changed
      }
    }
    for (const grand of edges().filter((edge) => edge.type === 'grandparent')) {
      for (const child of edges().filter((edge) => edge.type === 'parent')) {
        if (grand.from !== child.from || child.to === grand.to) continue
        if (known.get(edgeKey(child.to, grand.to)) === 'parent') continue
        changed = link(child.to, grand.to, 'aunt/uncle') || changed
      }
    }
    for (const aunt of edges().filter((edge) => edge.type === 'aunt/uncle')) {
      for (const parent of edges().filter((edge) => edge.type === 'parent')) {
        if (aunt.from === parent.from && parent.to !== aunt.to) changed = link(parent.to, aunt.to, 'cousin') || changed
      }
    }
    if (!changed) break
  }

  const members = new Map<string, string>()
  const find = (id: string): string => {
    const current = members.get(id) ?? id
    if (current === id) return id
    const root = find(current)
    members.set(id, root)
    return root
  }
  const people = new Set<string>()
  for (const edge of explicit) {
    if (edge.type.trim().toLowerCase() !== 'coworker' || edge.from === edge.to) continue
    people.add(edge.from)
    people.add(edge.to)
    members.set(find(edge.from), find(edge.to))
  }
  const groups = new Map<string, string[]>()
  for (const person of people) {
    const root = find(person)
    const list = groups.get(root) ?? []
    list.push(person)
    groups.set(root, list)
  }
  for (const group of groups.values()) {
    for (const left of group) {
      for (const right of group) {
        if (left !== right) link(left, right, 'coworker')
      }
    }
  }

  return edges().filter((edge) => !locked.has(edgeKey(edge.from, edge.to)) && !explicitPairs.has(pairKey(edge.from, edge.to)))
}
