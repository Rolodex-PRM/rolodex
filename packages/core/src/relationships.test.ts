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

  it('suggests an aunt or uncle for another child of a grandparent', () => {
    const edges = inferRelationships([
      { from: 'ada', to: 'bea', type: 'grandchild' },
      { from: 'cy', to: 'bea', type: 'child' },
    ])
    expect(has(edges, 'cy', 'ada', 'aunt/uncle')).toBe(true)
    expect(has(edges, 'ada', 'cy', 'niece/nephew')).toBe(true)
    expect(edges.find((edge) => edge.from === 'cy' && edge.to === 'ada')?.reason).toBe('Another child of a grandparent')
  })

  it('treats a parent’s spouse as a parent and an aunt’s spouse as an aunt or uncle', () => {
    const edges = inferRelationships([
      { from: 'mom', to: 'kid', type: 'parent' },
      { from: 'mom', to: 'dad', type: 'spouse' },
      { from: 'mom', to: 'uncle', type: 'sibling' },
      { from: 'uncle', to: 'aunt', type: 'spouse' },
    ])
    expect(has(edges, 'dad', 'kid', 'parent')).toBe(true)
    expect(has(edges, 'uncle', 'kid', 'aunt/uncle')).toBe(true)
    expect(has(edges, 'aunt', 'kid', 'aunt/uncle')).toBe(true)
    expect(edges.find((edge) => edge.from === 'aunt' && edge.to === 'kid')?.reason).toBe('Partner of an aunt or uncle')
  })

  it('names a parent of a grandparent as a great-grandparent', () => {
    const edges = inferRelationships([
      { from: 'ada', to: 'bea', type: 'parent' },
      { from: 'bea', to: 'cy', type: 'parent' },
      { from: 'cy', to: 'dee', type: 'parent' },
    ])
    expect(has(edges, 'ada', 'cy', 'grandparent')).toBe(true)
    expect(has(edges, 'ada', 'dee', 'great-grandparent')).toBe(true)
    expect(has(edges, 'dee', 'ada', 'great-grandchild')).toBe(true)
    expect(has(edges, 'bea', 'dee', 'grandparent')).toBe(true)
  })

  it('suggests coworkers who share an organization with someone already linked', () => {
    const edges = inferRelationships(
      [
        { from: 'ann', to: 'bo', type: 'coworker' },
        { from: 'ann', to: 'dee', type: 'friend' },
      ],
      [['bo', 'cam']],
    )
    expect(has(edges, 'ann', 'cam', 'coworker')).toBe(true)
    expect(edges.find((edge) => edge.from === 'ann' && edge.to === 'cam')?.reason).toBe('Shares a coworker')
    expect(edges.find((edge) => edge.from === 'bo' && edge.to === 'cam')?.reason).toBe('Works at the same organization')
    expect(has(edges, 'dee', 'cam', 'coworker')).toBe(false)
    expect(has(edges, 'ann', 'dee', 'coworker')).toBe(false)
  })
})
