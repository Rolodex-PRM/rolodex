import { describe, expect, it } from 'vitest'
import { buildSummary, calendarIcs, enrichFromEmail, groupDuplicates } from './phase5'

describe('phase 5', () => {
  it('groups the same email before the same name', () => {
    const groups = groupDuplicates([
      { id: 'a', name: 'Ada Lovelace', emails: ['ada@analytical.dev'], phones: [] },
      { id: 'b', name: 'Ada Lovelace', emails: ['Ada@analytical.dev'], phones: [] },
      { id: 'c', name: 'Ada Lovelace', emails: [], phones: [] },
    ])
    expect(groups[0]).toEqual({ reason: 'email', contactIds: ['a', 'b'] })
    expect(groups.some((group) => group.contactIds.includes('c'))).toBe(false)
  })

  it('groups a shared phone and a shared full name', () => {
    const groups = groupDuplicates([
      { id: 'a', name: 'Bo Chen', emails: [], phones: ['+1 (555) 010-1000'] },
      { id: 'b', name: 'Bo', emails: [], phones: ['5550101000'] },
      { id: 'c', name: 'Cam Diaz', emails: [], phones: [] },
      { id: 'd', name: 'Cam Diaz', emails: [], phones: [] },
    ])
    expect(groups.map((group) => group.reason)).toEqual(['phone', 'name'])
  })

  it('fills a company from a work email and leaves personal mail alone', () => {
    expect(enrichFromEmail('ada@analytical.dev', null, null)).toEqual({ organizationName: 'Analytical', website: 'https://analytical.dev' })
    expect(enrichFromEmail('ada@gmail.com', null, null)).toEqual({ organizationName: null, website: null })
    expect(enrichFromEmail('ada@analytical.dev', 'Engines', 'https://analytical.dev').organizationName).toBeNull()
  })

  it('writes a summary from the history it was given', () => {
    const text = buildSummary({ name: 'Ada', organization: 'Engines', relationships: [{ type: 'coworker', name: 'Bo' }], lastInteractionAt: '2026-01-02T00:00:00.000Z', notes: ['Talked about the engine.'], activityCount: 2 })
    expect(text).toContain('Ada at Engines')
    expect(text).toContain('2 logged interactions')
    expect(text).toContain('1 coworker')
    expect(text).toContain('Talked about the engine.')
  })

  it('builds a calendar file', () => {
    expect(calendarIcs([{ date: '2026-11-03', kind: 'birthday', title: 'Ada' }])).toContain('DTSTART;VALUE=DATE:20261103')
  })
})
