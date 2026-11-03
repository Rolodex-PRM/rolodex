import { describe, expect, it } from 'vitest'
import { htmlToText, pageContains, publicHttpUrl } from './ai'
import { buildVevent, parseVevent } from './calendar'

describe('AI source checks', () => {
  it('keeps a value only when the page states it', () => {
    const page = htmlToText('<p>Ada Lovelace works at Analytical Engines.</p>')
    expect(pageContains(page, 'Analytical Engines')?.excerpt).toContain('Analytical Engines')
    expect(pageContains(page, 'Invented the internet')).toBeNull()
  })

  it('rejects private and non-web sources', () => {
    expect(publicHttpUrl('https://example.com/about')).toBeTruthy()
    expect(publicHttpUrl('http://127.0.0.1/secret')).toBeNull()
    expect(publicHttpUrl('http://192.168.1.20/admin')).toBeNull()
    expect(publicHttpUrl('http://169.254.169.254/latest')).toBeNull()
    expect(publicHttpUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('calendar events', () => {
  it('keeps the event type through an ics round trip', () => {
    const ics = buildVevent({
      uid: 'event-1',
      type: 'meeting',
      summary: 'Lunch with Ada',
      description: 'Bring notes',
      location: 'The lab',
      priority: 1,
      rrule: 'FREQ=WEEKLY',
      start: '2026-11-03T12:00:00.000Z',
      end: '2026-11-04T12:00:00.000Z',
      allDay: true,
    })
    const parsed = parseVevent(ics)
    expect(parsed.type).toBe('meeting')
    expect(parsed.summary).toBe('Lunch with Ada')
    expect(parsed.allDay).toBe(true)
    expect(parsed.date).toBe('2026-11-03')
    expect(parsed.location).toBe('The lab')
    expect(parsed.priority).toBe(1)
    expect(parsed.rrule).toBe('FREQ=WEEKLY')
  })
})

describe('calendar recurrence', () => {
  it('lists weekly dates inside the month', async () => {
    const { datesInMonth } = await import('./calendar')
    expect(datesInMonth('2026-11-02', 'FREQ=WEEKLY', 2026, 11)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    expect(datesInMonth('2026-10-03', null, 2026, 11)).toEqual([])
  })
})

describe('caldav tasks', () => {
  it('keeps title, due date, priority, notes, and recurrence', async () => {
    const { buildVtodo, parseVtodo } = await import('./calendar')
    const ics = buildVtodo({
      uid: 'task-1',
      summary: 'Call Ada',
      notes: 'Ask about the engine',
      due: '2026-11-03',
      priority: 1,
      rrule: 'FREQ=MONTHLY',
      completed: false,
    })
    const parsed = parseVtodo(ics)
    expect(parsed.summary).toBe('Call Ada')
    expect(parsed.due).toBe('2026-11-03')
    expect(parsed.priority).toBe(1)
    expect(parsed.notes).toBe('Ask about the engine')
    expect(parsed.rrule).toBe('FREQ=MONTHLY')
    expect(parsed.completed).toBe(false)
  })
})
