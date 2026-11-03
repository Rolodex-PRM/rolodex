import { describe, expect, it } from 'vitest'
import { inferRelationships, type KinEdge } from './relationships'

const has = (edges: KinEdge[], from: string, to: string, type: string) => edges.some((edge) => edge.from === from && edge.to === to && edge.type === type)

describe('relationship inference', () => {
  it('treats a grandparent’s spouse as a grandparent and the other children as aunts and uncles', () => {
    const edges = inferRelationships([
      { from: 'grandchild', to: 'grandparent', type: 'grandchild' },
      { from: 'grandparent', to: 'spouse', type: 'spouse' },
      { from: 'grandparent', to: 'parent', type: 'parent' },
      { from: 'parent', to: 'grandchild', type: 'parent' },
      { from: 'grandparent', to: 'uncle', type: 'parent' },
    ])
    expect(has(edges, 'spouse', 'grandchild', 'grandparent')).toBe(true)
    expect(has(edges, 'grandchild', 'spouse', 'grandchild')).toBe(true)
    expect(has(edges, 'uncle', 'grandchild', 'aunt/uncle')).toBe(true)
    expect(has(edges, 'grandchild', 'uncle', 'niece/nephew')).toBe(true)
    expect(has(edges, 'parent', 'grandchild', 'parent')).toBe(false)
    expect(has(edges, 'uncle', 'parent', 'sibling')).toBe(true)
  })

  it('builds grandparents, siblings, aunts, and cousins from parent links', () => {
    const edges = inferRelationships([
      { from: 'ada', to: 'bea', type: 'parent' },
      { from: 'bea', to: 'cy', type: 'parent' },
      { from: 'ada', to: 'drew', type: 'parent' },
      { from: 'drew', to: 'eve', type: 'parent' },
      { from: 'ada', to: 'sam', type: 'spouse' },
    ])
    expect(has(edges, 'ada', 'cy', 'grandparent')).toBe(true)
    expect(has(edges, 'sam', 'cy', 'grandparent')).toBe(true)
    expect(has(edges, 'cy', 'ada', 'grandchild')).toBe(true)
    expect(has(edges, 'bea', 'drew', 'sibling')).toBe(true)
    expect(has(edges, 'drew', 'cy', 'aunt/uncle')).toBe(true)
    expect(has(edges, 'eve', 'cy', 'cousin')).toBe(true)
    expect(has(edges, 'cy', 'eve', 'cousin')).toBe(true)
  })

  it('shares coworker with everyone in that coworker group', () => {
    const edges = inferRelationships([
      { from: 'ann', to: 'bo', type: 'coworker' },
      { from: 'bo', to: 'cam', type: 'coworker' },
      { from: 'ann', to: 'dee', type: 'friend' },
    ])
    expect(has(edges, 'ann', 'cam', 'coworker')).toBe(true)
    expect(has(edges, 'cam', 'ann', 'coworker')).toBe(true)
    expect(has(edges, 'ann', 'dee', 'coworker')).toBe(false)
    expect(has(edges, 'dee', 'cam', 'coworker')).toBe(false)
  })

  it('keeps an edited relationship ahead of an inferred one', () => {
    const edges = inferRelationships([
      { from: 'ann', to: 'bo', type: 'coworker' },
      { from: 'bo', to: 'cam', type: 'coworker' },
      { from: 'ann', to: 'cam', type: 'friend' },
    ])
    expect(edges.some((edge) => edge.from === 'ann' && edge.to === 'cam')).toBe(false)
  })
})
