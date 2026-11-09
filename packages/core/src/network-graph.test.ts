import { describe, expect, it } from 'vitest'
import { assembleNetwork, countPairInteractions, findPath, focusPerson, searchNetwork } from './network-graph'

const person = (id: string, name: string, lastName = name.split(' ').at(-1) ?? '') => ({
  id,
  name,
  lastName,
  organizationName: null,
  title: null,
  hasPhoto: false,
  followUpFrequency: null,
  lastInteractionAt: null,
})

const edge = (id: string, from: string, to: string, type: string, reciprocal: string, inferred = false) => ({
  id,
  from,
  to,
  type,
  reciprocal,
  inferred,
  description: inferred ? 'Parent of a parent' : null,
  createdAt: '2026-01-01T00:00:00.000Z',
})

function hundredEdges() {
  const types = ['friend', 'coworker', 'neighbor', 'mentor', 'spouse'] as const
  const seen = new Set<string>()
  const rows: { from: string; to: string; type: string; weight: number }[] = []
  const add = (left: number, right: number, type: string, weight: number) => {
    if (left === right || rows.length >= 100) return
    const from = Math.min(left, right)
    const to = Math.max(left, right)
    const key = `${from}:${to}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ from: `p${from}`, to: `p${to}`, type, weight })
  }
  for (let index = 1; index < 28; index += 1) add(0, index, types[index % 4]!, index % 9)
  for (let index = 1; index <= 8; index += 2) add(index, index + 1, 'spouse', 6)
  for (let step = 1; rows.length < 100 && step < 8; step += 1) {
    for (let index = 1; index < 28 && rows.length < 100; index += 1) {
      add(index, 1 + ((index - 1 + step) % 27), types[(index + step) % 4]!, (index + step) % 9)
    }
  }
  return rows
}

function family() {
  return assembleNetwork({
    people: [person('ada', 'Ada Ellison'), person('bea', 'Bea Ellison'), person('cy', 'Cy Ellison'), person('jo', 'Jo Hale', 'Hale')],
    edges: [
      edge('1', 'ada', 'bea', 'parent', 'child'),
      edge('2', 'bea', 'ada', 'child', 'parent'),
      edge('3', 'bea', 'cy', 'parent', 'child'),
      edge('4', 'ada', 'cy', 'grandparent', 'grandchild', true),
      edge('5', 'cy', 'jo', 'friend', 'friend'),
    ],
    organizations: [{ id: 'org', name: 'Northwind', memberIds: ['bea', 'hidden'] }],
    households: [],
  })
}

describe('network graph projection', () => {
  it('collapses both directions and keeps a family cluster separate from friends', () => {
    const graph = family()
    const parent = graph.edges.find((item) => item.from === 'ada' && item.to === 'bea')
    expect(parent?.type).toBe('parent')
    expect(parent?.inferred).toBe(false)
    expect(graph.edges.some((item) => item.type === 'child')).toBe(false)
    expect(graph.clusters.find((item) => item.kind === 'family')?.memberIds.sort()).toEqual(['ada', 'bea', 'cy'])
    expect(graph.clusters.find((item) => item.kind === 'person')?.name).toBe('Jo Hale')
    expect(graph.organizations[0]?.memberIds).toEqual(['bea'])
    expect(graph.clusterEdges.some((item) => item.type === 'friend')).toBe(true)
  })

  it('does not walk through a person who is absent from the graph', () => {
    const graph = family()
    expect(findPath(graph, 'ada', 'jo')).toEqual(['ada', 'cy', 'jo'])
    expect(findPath(graph, 'ada', 'hidden')).toBeNull()
    expect(focusPerson(graph, 'hidden')).toBeNull()
    expect(focusPerson(graph, 'cy')?.people.map((item) => item.id).sort()).toEqual(['ada', 'bea', 'cy', 'jo'])
  })

  it('weights a relationship by shared interactions and leaves the record itself alone', () => {
    const graph = assembleNetwork({
      people: [person('ada', 'Ada Ellison'), person('bea', 'Bea Ellison'), person('cy', 'Cy Ellison'), person('jo', 'Jo Hale', 'Hale')],
      edges: [
        edge('1', 'ada', 'bea', 'parent', 'child'),
        edge('2', 'bea', 'ada', 'child', 'parent'),
        edge('3', 'cy', 'jo', 'friend', 'friend'),
      ],
      organizations: [],
      households: [],
      interactions: countPairInteractions([
        { activityId: 'a', contactId: 'ada' },
        { activityId: 'a', contactId: 'bea' },
        { activityId: 'b', contactId: 'ada' },
        { activityId: 'b', contactId: 'bea' },
        { activityId: 'b', contactId: 'cy' },
        { activityId: 'c', contactId: 'cy' },
        { activityId: 'c', contactId: 'jo' },
        { activityId: 'd', contactId: 'ada' },
      ]),
    })
    expect(graph.edges.find((item) => item.from === 'ada' && item.to === 'bea')?.interactions).toBe(2)
    expect(graph.edges.find((item) => item.type === 'friend')?.interactions).toBe(1)
    expect(graph.edges.some((item) => item.from === 'ada' && item.to === 'cy')).toBe(false)
    expect(graph.clusterEdges.find((item) => item.type === 'friend')?.interactions).toBe(1)
    expect(graph.clusterEdges.find((item) => item.type === 'friend')?.category).toBe('friend')
  })

  it('keeps one hundred interconnected relationships connected and colored', () => {
    const people = Array.from({ length: 28 }, (_, index) => person(`p${index}`, `Person ${index} Harbor`, 'Harbor'))
    const rows = hundredEdges()
    const graph = assembleNetwork({
      people,
      edges: rows.map((row, index) => edge(String(index), row.from, row.to, row.type, row.type)),
      organizations: [],
      households: [],
      interactions: rows.map((row) => ({ from: row.from, to: row.to, count: row.weight })),
    })
    expect(graph.edges).toHaveLength(100)
    expect(new Set(graph.edges.map((item) => item.category))).toEqual(new Set(['family', 'friend', 'work', 'other']))
    expect(graph.edges.filter((item) => item.interactions === 0)).toHaveLength(rows.filter((row) => row.weight === 0).length)
    expect(findPath(graph, 'p0', 'p27')).not.toBeNull()
    expect(findPath(graph, 'p0', 'missing')).toBeNull()
    const started = performance.now()
    assembleNetwork({
      people,
      edges: rows.map((row, index) => edge(String(index), row.from, row.to, row.type, row.type)),
      organizations: [],
      households: [],
      interactions: rows.map((row) => ({ from: row.from, to: row.to, count: row.weight })),
    })
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('searches only visible names', () => {
    const graph = family()
    expect(searchNetwork(graph, 'ellison').people).toHaveLength(3)
    expect(searchNetwork(graph, 'north').organizations.map((item) => item.name)).toEqual(['Northwind'])
    expect(searchNetwork(graph, '  ').people).toHaveLength(0)
  })
})
