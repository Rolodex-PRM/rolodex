export type KinEdge = { from: string; to: string; type: string; reason?: string }

const inverseOf: Record<string, string> = {
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

const rankOf: Record<string, number> = {
  spouse: 1,
  parent: 2,
  child: 2,
  sibling: 3,
  grandparent: 4,
  grandchild: 4,
  'great-grandparent': 4,
  'great-grandchild': 4,
  'aunt/uncle': 5,
  'niece/nephew': 5,
  cousin: 6,
  coworker: 8,
  friend: 9,
}

const coworkerTypes = new Set(['coworker', 'colleague'])

const edgeKey = (from: string, to: string) => `${from}\0${to}`
const pairKey = (from: string, to: string) => (from < to ? `${from}\0${to}` : `${to}\0${from}`)

type Stored = { type: string; reason: string; locked: boolean }

export function inferRelationships(explicit: KinEdge[], coworkerGroups: string[][] = []): KinEdge[] {
  const known = new Map<string, Stored>()
  const explicitPairs = new Set<string>()

  for (const edge of explicit) {
    const type = edge.type.trim().toLowerCase()
    if (!edge.from || !edge.to || edge.from === edge.to || !type) continue
    known.set(edgeKey(edge.from, edge.to), { type, reason: '', locked: true })
    explicitPairs.add(pairKey(edge.from, edge.to))
    const back = inverseOf[type]
    const backKey = edgeKey(edge.to, edge.from)
    if (back && !known.has(backKey)) known.set(backKey, { type: back, reason: '', locked: true })
  }

  const setOne = (from: string, to: string, type: string, reason: string) => {
    if (from === to || explicitPairs.has(pairKey(from, to))) return false
    const id = edgeKey(from, to)
    const current = known.get(id)
    if (current?.locked) return false
    const nextRank = rankOf[type] ?? 50
    const currentRank = current ? (rankOf[current.type] ?? 50) : Number.POSITIVE_INFINITY
    if (current && currentRank <= nextRank) return false
    known.set(id, { type, reason, locked: false })
    return true
  }

  const relate = (from: string, to: string, type: string, reason: string) => {
    const back = inverseOf[type]
    if (!back) return false
    const forward = setOne(from, to, type, reason)
    const backward = setOne(to, from, back, reason)
    return forward || backward
  }

  const edges = () =>
    [...known.entries()].map(([id, stored]) => {
      const [from, to] = id.split('\0')
      return { from: from!, to: to!, type: stored.type }
    })

  const ofType = (type: string) => edges().filter((edge) => edge.type === type)

  const parentsOf = () => {
    const map = new Map<string, string[]>()
    for (const edge of ofType('parent')) {
      const ups = map.get(edge.to) ?? []
      ups.push(edge.from)
      map.set(edge.to, ups)
    }
    return map
  }

  const isAncestor = (person: string, maybe: string, parents: Map<string, string[]>) => {
    const seen = new Set<string>()
    const stack = [...(parents.get(person) ?? [])]
    while (stack.length) {
      const next = stack.pop()!
      if (next === maybe) return true
      if (seen.has(next)) continue
      seen.add(next)
      for (const up of parents.get(next) ?? []) stack.push(up)
    }
    return false
  }

  const other = (edge: KinEdge, person: string) => (edge.from === person ? edge.to : edge.to === person ? edge.from : '')

  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    for (const partner of ofType('spouse')) {
      for (const parent of ofType('parent')) {
        const spouse = other(partner, parent.from)
        if (!spouse || spouse === parent.to) continue
        if (isAncestor(spouse, parent.to, parentsOf())) continue
        changed = relate(spouse, parent.to, 'parent', 'Partner of a parent') || changed
      }
    }
    const childrenOf = new Map<string, string[]>()
    for (const parent of ofType('parent')) {
      const list = childrenOf.get(parent.from) ?? []
      list.push(parent.to)
      childrenOf.set(parent.from, list)
    }
    for (const children of childrenOf.values()) {
      for (const left of children) {
        for (const right of children) {
          if (left !== right) changed = relate(left, right, 'sibling', 'Shares a parent') || changed
        }
      }
    }
    for (const parent of ofType('parent')) {
      for (const next of ofType('parent')) {
        if (parent.to === next.from) changed = relate(parent.from, next.to, 'grandparent', 'Parent of a parent') || changed
      }
    }
    for (const grand of ofType('grandparent')) {
      for (const spouse of ofType('spouse')) {
        const partner = other(spouse, grand.from)
        if (partner) changed = relate(partner, grand.to, 'grandparent', 'Partner of a grandparent') || changed
      }
    }
    for (const grand of ofType('grandparent')) {
      for (const parent of ofType('parent')) {
        if (parent.to === grand.from) changed = relate(parent.from, grand.to, 'great-grandparent', 'Parent of a grandparent') || changed
        if (parent.from === grand.to) changed = relate(grand.from, parent.to, 'great-grandparent', 'Parent of a grandparent') || changed
      }
    }
    for (const parent of ofType('parent')) {
      for (const sibling of ofType('sibling')) {
        const aunt = other(sibling, parent.from)
        if (aunt && aunt !== parent.to) changed = relate(aunt, parent.to, 'aunt/uncle', 'Sibling of a parent') || changed
      }
    }
    for (const grand of ofType('grandparent')) {
      for (const parent of ofType('parent')) {
        if (grand.from !== parent.from || parent.to === grand.to) continue
        if (known.get(edgeKey(parent.to, grand.to))?.type === 'parent') continue
        if (known.get(edgeKey(grand.to, parent.to))?.type === 'parent') continue
        changed = relate(parent.to, grand.to, 'aunt/uncle', 'Another child of a grandparent') || changed
      }
    }
    for (const aunt of ofType('aunt/uncle')) {
      for (const spouse of ofType('spouse')) {
        const partner = other(spouse, aunt.from)
        if (partner && partner !== aunt.to) changed = relate(partner, aunt.to, 'aunt/uncle', 'Partner of an aunt or uncle') || changed
      }
      for (const parent of ofType('parent')) {
        if (aunt.from === parent.from && parent.to !== aunt.to) changed = relate(parent.to, aunt.to, 'cousin', 'Child of an aunt or uncle') || changed
      }
    }
    const grandchildren = new Map<string, string[]>()
    for (const grand of ofType('grandparent')) {
      const list = grandchildren.get(grand.from) ?? []
      list.push(grand.to)
      grandchildren.set(grand.from, list)
    }
    for (const kids of grandchildren.values()) {
      for (const left of kids) {
        for (const right of kids) {
          if (left === right) continue
          if (known.get(edgeKey(left, right))?.type === 'parent' || known.get(edgeKey(right, left))?.type === 'parent') continue
          changed = relate(left, right, 'cousin', 'Grandchildren of the same person') || changed
        }
      }
    }
    if (!changed) break
  }

  const seeds: [string, string][] = []
  for (const edge of explicit) {
    const type = edge.type.trim().toLowerCase()
    if (!coworkerTypes.has(type) || !edge.from || !edge.to || edge.from === edge.to) continue
    seeds.push([edge.from, edge.to])
  }
  const rootOf = new Map<string, string>()
  const find = (id: string): string => {
    const current = rootOf.get(id) ?? id
    if (current === id) return id
    const root = find(current)
    rootOf.set(id, root)
    return root
  }
  const unite = (left: string, right: string) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) rootOf.set(a, b)
  }
  const orgPairs = new Set<string>()
  for (const group of coworkerGroups) {
    const people = [...new Set(group.filter(Boolean))]
    for (let index = 0; index < people.length; index += 1) {
      for (let next = index + 1; next < people.length; next += 1) {
        unite(people[index]!, people[next]!)
        orgPairs.add(pairKey(people[index]!, people[next]!))
      }
    }
  }
  for (const [left, right] of seeds) unite(left, right)
  const people = new Set<string>([...seeds.flat(), ...coworkerGroups.flat()])
  const groups = new Map<string, string[]>()
  for (const person of people) {
    if (!person) continue
    const root = find(person)
    const list = groups.get(root) ?? []
    list.push(person)
    groups.set(root, list)
  }
  for (const group of groups.values()) {
    for (const left of group) {
      for (const right of group) {
        if (left === right) continue
        relate(left, right, 'coworker', orgPairs.has(pairKey(left, right)) ? 'Works at the same organization' : 'Shares a coworker')
      }
    }
  }

  return [...known.entries()]
    .filter(([id, stored]) => !stored.locked && !explicitPairs.has(pairKey(...(id.split('\0') as [string, string]))))
    .map(([id, stored]) => {
      const [from, to] = id.split('\0')
      return { from: from!, to: to!, type: stored.type, reason: stored.reason }
    })
}
