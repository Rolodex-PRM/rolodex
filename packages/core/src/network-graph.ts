import { activities, activityContacts, households, householdMembers, organizationMemberships, organizations, relationships, contacts, type Database } from '@rolodex/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { requireMembership, requireWriter } from './access'
import { visibleContactSql } from './contacts'
import { syncInferredRelationships } from './crm'
import { AppError } from './errors'

export type RelationCategory = 'family' | 'friend' | 'work' | 'other'

const familyTypes = new Set([
  'spouse',
  'parent',
  'child',
  'sibling',
  'grandparent',
  'grandchild',
  'great-grandparent',
  'great-grandchild',
  'aunt/uncle',
  'niece/nephew',
  'cousin',
  'boyfriend/girlfriend',
])

const upstreamTypes = new Set(['parent', 'grandparent', 'great-grandparent', 'aunt/uncle'])

export type NetworkPerson = {
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

export type NetworkEdge = {
  id: string
  from: string
  to: string
  type: string
  reciprocal: string | null
  category: RelationCategory
  inferred: boolean
  description: string | null
  directed: boolean
  createdAt: string
  interactions: number
}

export type NetworkGroup = { id: string; name: string; memberIds: string[] }

export type NetworkCluster = {
  id: string
  kind: 'family' | 'organization' | 'person'
  name: string
  memberIds: string[]
  size: number
}

export type NetworkClusterEdge = { id: string; from: string; to: string; type: string; category: RelationCategory; count: number; interactions: number }

export type NetworkGraph = {
  people: NetworkPerson[]
  organizations: NetworkGroup[]
  households: NetworkGroup[]
  edges: NetworkEdge[]
  clusters: NetworkCluster[]
  clusterEdges: NetworkClusterEdge[]
}

type RawEdge = {
  id: string
  from: string
  to: string
  type: string
  reciprocal: string | null
  inferred: boolean
  description: string | null
  createdAt: string
}

type RawPerson = {
  id: string
  name: string
  lastName: string
  organizationName: string | null
  title: string | null
  hasPhoto: boolean
  followUpFrequency?: string | null
  lastInteractionAt?: string | null
}

export function relationshipCategory(type: string): RelationCategory {
  const value = type.trim().toLowerCase()
  if (familyTypes.has(value)) return 'family'
  if (value === 'friend' || value === 'boyfriend/girlfriend') return 'friend'
  if (value === 'coworker' || value === 'colleague' || value === 'member') return 'work'
  return 'other'
}

export function collapseEdges(rows: RawEdge[]): NetworkEdge[] {
  const grouped = new Map<string, RawEdge>()
  for (const row of rows) {
    if (!row.from || !row.to || row.from === row.to || !row.type.trim()) continue
    const key = row.from < row.to ? `${row.from}\0${row.to}` : `${row.to}\0${row.from}`
    const current = grouped.get(key)
    grouped.set(key, current ? preferEdge(current, row) : row)
  }
  return [...grouped.values()].map((row) => ({
    id: row.id,
    from: row.from,
    to: row.to,
    type: row.type,
    reciprocal: row.reciprocal,
    category: relationshipCategory(row.type),
    inferred: row.inferred,
    description: row.description,
    directed: row.type.trim().toLowerCase() !== (row.reciprocal ?? row.type).trim().toLowerCase(),
    createdAt: row.createdAt,
    interactions: 0,
  }))
}

function preferEdge(left: RawEdge, right: RawEdge) {
  if (left.inferred !== right.inferred) return left.inferred ? right : left
  const leftUp = upstreamTypes.has(left.type.trim().toLowerCase())
  const rightUp = upstreamTypes.has(right.type.trim().toLowerCase())
  if (leftUp !== rightUp) return leftUp ? left : right
  return left.id < right.id ? left : right
}

export function countPairInteractions(rows: { activityId: string; contactId: string }[]) {
  const byActivity = new Map<string, string[]>()
  for (const row of rows) {
    const list = byActivity.get(row.activityId) ?? []
    if (!list.includes(row.contactId)) list.push(row.contactId)
    byActivity.set(row.activityId, list)
  }
  const counts = new Map<string, { from: string; to: string; count: number }>()
  for (const ids of byActivity.values()) {
    const people = [...new Set(ids)].sort()
    for (let left = 0; left < people.length; left += 1) {
      for (let right = left + 1; right < people.length; right += 1) {
        const from = people[left]!
        const to = people[right]!
        const key = `${from}\0${to}`
        const current = counts.get(key) ?? { from, to, count: 0 }
        current.count += 1
        counts.set(key, current)
      }
    }
  }
  return [...counts.values()]
}

function pairKey(left: string, right: string) {
  return left < right ? `${left}\0${right}` : `${right}\0${left}`
}

export function assembleNetwork(input: {
  people: RawPerson[]
  edges: RawEdge[]
  organizations: NetworkGroup[]
  households: NetworkGroup[]
  interactions?: { from: string; to: string; count: number }[]
}): NetworkGraph {
  const known = new Set(input.people.map((person) => person.id))
  const weights = new Map<string, number>()
  for (const pair of input.interactions ?? []) {
    if (!known.has(pair.from) || !known.has(pair.to) || pair.from === pair.to) continue
    const key = pairKey(pair.from, pair.to)
    weights.set(key, (weights.get(key) ?? 0) + pair.count)
  }
  const edges = collapseEdges(input.edges.filter((edge) => known.has(edge.from) && known.has(edge.to))).map((edge) => ({
    ...edge,
    interactions: weights.get(pairKey(edge.from, edge.to)) ?? 0,
  }))
  const degree = new Map<string, number>()
  for (const person of input.people) degree.set(person.id, 0)
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const people = input.people.map((person) => ({
    ...person,
    initials: initials(person.name),
    degree: degree.get(person.id) ?? 0,
    followUpFrequency: person.followUpFrequency ?? null,
    lastInteractionAt: person.lastInteractionAt ?? null,
  }))
  const organizations = input.organizations
    .map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => known.has(id)) }))
    .filter((group) => group.memberIds.length > 0)
  const households = input.households
    .map((group) => ({ ...group, memberIds: group.memberIds.filter((id) => known.has(id)) }))
    .filter((group) => group.memberIds.length > 0)
  const { clusters, clusterEdges } = overview(people, edges, organizations, households)
  return { people, organizations, households, edges, clusters, clusterEdges }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return `${first}${last}`.toUpperCase() || '?'
}

export function overview(
  people: NetworkPerson[],
  edges: NetworkEdge[],
  organizations: NetworkGroup[],
  households: NetworkGroup[],
) {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const current = parent.get(id) ?? id
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const unite = (left: string, right: string) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent.set(b, a)
  }
  for (const person of people) parent.set(person.id, person.id)
  for (const edge of edges) {
    if (edge.category === 'family') unite(edge.from, edge.to)
  }
  const components = new Map<string, string[]>()
  for (const person of people) {
    const root = find(person.id)
    const list = components.get(root) ?? []
    list.push(person.id)
    components.set(root, list)
  }
  const byId = new Map(people.map((person) => [person.id, person]))
  const familyOf = new Map<string, string>()
  const clusters: NetworkCluster[] = []
  for (const members of components.values()) {
    if (members.length < 2) continue
    const id = `family:${[...members].sort()[0]}`
    for (const member of members) familyOf.set(member, id)
    clusters.push({ id, kind: 'family', name: familyName(members, byId, households), memberIds: members, size: members.length })
  }
  const standalone = new Set<string>()
  for (const person of people) {
    if (familyOf.has(person.id) || person.degree === 0) continue
    standalone.add(person.id)
    clusters.push({ id: `person:${person.id}`, kind: 'person', name: person.name, memberIds: [person.id], size: 1 })
  }
  for (const org of organizations) {
    clusters.push({ id: `org:${org.id}`, kind: 'organization', name: org.name, memberIds: org.memberIds, size: org.memberIds.length })
  }
  const between = new Map<string, { count: number; interactions: number; types: Map<string, number> }>()
  const addLink = (from: string, to: string, type: string, interactions: number) => {
    if (from === to) return
    const key = from < to ? `${from}\0${to}` : `${to}\0${from}`
    const row = between.get(key) ?? { count: 0, interactions: 0, types: new Map<string, number>() }
    row.count += 1
    row.interactions += interactions
    row.types.set(type, (row.types.get(type) ?? 0) + 1)
    between.set(key, row)
  }
  for (const edge of edges) {
    const from = familyOf.get(edge.from) ?? (standalone.has(edge.from) ? `person:${edge.from}` : '')
    const to = familyOf.get(edge.to) ?? (standalone.has(edge.to) ? `person:${edge.to}` : '')
    if (from && to) addLink(from, to, edge.type, edge.interactions)
  }
  for (const org of organizations) {
    for (const member of org.memberIds) {
      const target = familyOf.get(member) ?? (standalone.has(member) ? `person:${member}` : '')
      if (target) addLink(`org:${org.id}`, target, 'member', 0)
    }
  }
  const clusterEdges: NetworkClusterEdge[] = [...between.entries()].map(([key, row]) => {
    const [from, to] = key.split('\0')
    const type = [...row.types.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'connected'
    return { id: key, from: from!, to: to!, type, category: relationshipCategory(type), count: row.count, interactions: row.interactions }
  })
  return { clusters, clusterEdges }
}

function familyName(members: string[], byId: Map<string, NetworkPerson>, households: NetworkGroup[]) {
  const memberSet = new Set(members)
  const household = households
    .map((group) => ({ group, shared: group.memberIds.filter((id) => memberSet.has(id)).length }))
    .filter((row) => row.shared >= Math.ceil(members.length / 2))
    .sort((left, right) => right.shared - left.shared)[0]
  if (household) return household.group.name
  const counts = new Map<string, number>()
  for (const id of members) {
    const name = byId.get(id)?.lastName || lastWord(byId.get(id)?.name ?? '')
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  return top ? `${top} family` : 'Family'
}

function lastWord(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1]! : ''
}

export function focusPerson(graph: NetworkGraph, personId: string) {
  const person = graph.people.find((item) => item.id === personId)
  if (!person) return null
  const ids = new Set<string>([personId])
  for (const edge of graph.edges) {
    if (edge.from === personId) ids.add(edge.to)
    if (edge.to === personId) ids.add(edge.from)
  }
  return slice(graph, ids, personId)
}

export function focusOrganization(graph: NetworkGraph, organizationId: string) {
  const organization = graph.organizations.find((item) => item.id === organizationId)
  if (!organization) return null
  return {
    focusId: organizationId,
    people: graph.people.filter((person) => organization.memberIds.includes(person.id)),
    edges: graph.edges.filter((edge) => organization.memberIds.includes(edge.from) && organization.memberIds.includes(edge.to)),
    organizations: [organization],
    households: graph.households.filter((group) => group.memberIds.some((id) => organization.memberIds.includes(id))),
  }
}

function slice(graph: NetworkGraph, ids: Set<string>, focusId: string) {
  return {
    focusId,
    people: graph.people.filter((person) => ids.has(person.id)),
    edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    organizations: graph.organizations.filter((group) => group.memberIds.some((id) => ids.has(id))),
    households: graph.households.filter((group) => group.memberIds.some((id) => ids.has(id))),
  }
}

export function findPath(graph: NetworkGraph, from: string, to: string) {
  const known = new Set(graph.people.map((person) => person.id))
  if (!known.has(from) || !known.has(to)) return null
  if (from === to) return [from]
  const next = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const left = next.get(edge.from) ?? []
    left.push(edge.to)
    next.set(edge.from, left)
    const right = next.get(edge.to) ?? []
    right.push(edge.from)
    next.set(edge.to, right)
  }
  const previous = new Map<string, string | null>([[from, null]])
  const queue = [from]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    if (current === to) break
    for (const neighbor of next.get(current) ?? []) {
      if (previous.has(neighbor) || !known.has(neighbor)) continue
      previous.set(neighbor, current)
      queue.push(neighbor)
    }
  }
  if (!previous.has(to)) return null
  const path = [to]
  let cursor = to
  while (cursor !== from) {
    const prior = previous.get(cursor)
    if (!prior) return null
    path.push(prior)
    cursor = prior
  }
  return path.reverse()
}

export function searchNetwork(graph: NetworkGraph, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { people: [], organizations: [], households: [] }
  const matches = (name: string) => name.toLowerCase().includes(needle)
  return {
    people: graph.people.filter((person) => matches(person.name)).slice(0, 20),
    organizations: graph.organizations.filter((group) => matches(group.name)).slice(0, 20),
    households: graph.households.filter((group) => matches(group.name)).slice(0, 20),
  }
}

export async function loadNetworkGraph(db: Database, userId: string, workspaceId: string) {
  await requireMembership(db, userId, workspaceId)
  try {
    await requireWriter(db, userId, workspaceId)
    await syncInferredRelationships(db, workspaceId)
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 403) throw error
  }
  const people = await db
    .select({
      id: contacts.id,
      name: contacts.displayName,
      lastName: contacts.lastName,
      organizationName: contacts.organizationName,
      title: contacts.title,
      photoAttachmentId: contacts.photoAttachmentId,
      followUpFrequency: contacts.followUpFrequency,
      lastInteractionAt: contacts.lastInteractionAt,
    })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
  const visible = new Set(people.map((person) => person.id))
  const stored = visible.size
    ? await db
        .select({
          id: relationships.id,
          from: relationships.fromContactId,
          to: relationships.toContactId,
          type: relationships.type,
          reciprocal: relationships.reciprocalType,
          origin: relationships.origin,
          description: relationships.description,
          createdAt: relationships.createdAt,
        })
        .from(relationships)
        .where(eq(relationships.workspaceId, workspaceId))
    : []
  const activityRows = await db
    .select({
      activityId: activityContacts.activityId,
      contactId: activityContacts.contactId,
      visibility: activities.visibility,
      createdBy: activities.createdBy,
    })
    .from(activityContacts)
    .innerJoin(activities, eq(activities.id, activityContacts.activityId))
    .where(and(eq(activities.workspaceId, workspaceId), isNull(activities.deletedAt)))
  const interactions = countPairInteractions(
    activityRows.filter((row) => visible.has(row.contactId) && (row.visibility === 'workspace' || row.createdBy === userId)),
  )
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.workspaceId, workspaceId), isNull(organizations.deletedAt)))
  const memberships = orgs.length
    ? await db
        .select({ organizationId: organizationMemberships.organizationId, contactId: organizationMemberships.contactId })
        .from(organizationMemberships)
        .where(inArray(organizationMemberships.organizationId, orgs.map((org) => org.id)))
    : []
  const homes = await db
    .select({ id: households.id, name: households.name, visibility: households.visibility })
    .from(households)
    .where(and(eq(households.workspaceId, workspaceId), isNull(households.deletedAt)))
  const homeMembers = homes.length
    ? await db
        .select({ householdId: householdMembers.householdId, contactId: householdMembers.contactId })
        .from(householdMembers)
        .where(inArray(householdMembers.householdId, homes.map((home) => home.id)))
    : []
  return assembleNetwork({
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      lastName: person.lastName ?? '',
      organizationName: person.organizationName,
      title: person.title,
      hasPhoto: Boolean(person.photoAttachmentId),
      followUpFrequency: person.followUpFrequency,
      lastInteractionAt: person.lastInteractionAt?.toISOString() ?? null,
    })),
    edges: stored
      .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        type: edge.type,
        reciprocal: edge.reciprocal,
        inferred: edge.origin === 'inferred',
        description: edge.description,
        createdAt: edge.createdAt.toISOString(),
      })),
    interactions,
    organizations: orgs.map((org) => ({
      id: org.id,
      name: org.name,
      memberIds: memberships.filter((row) => row.organizationId === org.id).map((row) => row.contactId),
    })),
    households: homes
      .filter((home) => home.visibility === 'workspace')
      .map((home) => ({
        id: home.id,
        name: home.name,
        memberIds: homeMembers.filter((row) => row.householdId === home.id).map((row) => row.contactId),
      })),
  })
}

export async function personNetwork(db: Database, userId: string, workspaceId: string, contactId: string) {
  const graph = await loadNetworkGraph(db, userId, workspaceId)
  const view = focusPerson(graph, contactId)
  if (!view) throw new AppError(404, 'Contact not found')
  return view
}

export async function organizationNetwork(db: Database, userId: string, workspaceId: string, organizationId: string) {
  const graph = await loadNetworkGraph(db, userId, workspaceId)
  const view = focusOrganization(graph, organizationId)
  if (!view) throw new AppError(404, 'Organization not found')
  return view
}

export async function networkPath(db: Database, userId: string, workspaceId: string, from: string, to: string) {
  const graph = await loadNetworkGraph(db, userId, workspaceId)
  const path = findPath(graph, from, to)
  if (!path) throw new AppError(404, 'No visible path')
  const names = new Map(graph.people.map((person) => [person.id, person.name]))
  return { nodes: path.map((id) => ({ id, name: names.get(id) ?? '' })) }
}

export async function searchNetworkGraph(db: Database, userId: string, workspaceId: string, query: string) {
  return searchNetwork(await loadNetworkGraph(db, userId, workspaceId), query)
}

export async function networkDiscoveries(db: Database, userId: string, workspaceId: string) {
  const graph = await loadNetworkGraph(db, userId, workspaceId)
  const names = new Map(graph.people.map((person) => [person.id, person.name]))
  return graph.edges
    .filter((edge) => edge.inferred)
    .slice(0, 40)
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      fromName: names.get(edge.from) ?? '',
      toName: names.get(edge.to) ?? '',
      type: edge.type,
      description: edge.description,
    }))
}

export async function networkFilters(db: Database, userId: string, workspaceId: string) {
  const graph = await loadNetworkGraph(db, userId, workspaceId)
  return {
    categories: [...new Set(graph.edges.map((edge) => edge.category))],
    types: [...new Set(graph.edges.map((edge) => edge.type))].sort(),
  }
}
