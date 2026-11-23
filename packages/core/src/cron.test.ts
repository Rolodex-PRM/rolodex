import { describe, expect, it } from 'vitest'
import { assertCron, cronMatches, describeCron, isCronDue, nextCronRuns, previousCronRun } from './cron'

describe('cron', () => {
  it('parses and matches a daily 3am schedule', () => {
    const expression = assertCron('0 3 * * *')
    const hit = new Date(2026, 10, 23, 3, 0, 0, 0)
    const miss = new Date(2026, 10, 23, 3, 1, 0, 0)
    expect(cronMatches(expression, hit)).toBe(true)
    expect(cronMatches(expression, miss)).toBe(false)
  })

  it('describes weekday schedules', () => {
    expect(describeCron('0 9 * * 1-5')).toContain('9:00 AM')
    expect(describeCron('0 9 * * 1-5')).toContain('Mon through Fri')
  })

  it('finds upcoming runs', () => {
    const from = new Date(2026, 10, 23, 2, 0, 0, 0)
    const runs = nextCronRuns('0 3 * * *', from, 2)
    expect(runs).toHaveLength(2)
    expect(runs[0]?.getHours()).toBe(3)
    expect(runs[0]?.getMinutes()).toBe(0)
  })

  it('detects due schedules after the last fire', () => {
    const now = new Date(2026, 10, 23, 3, 5, 0, 0)
    const previous = previousCronRun('0 3 * * *', now)
    expect(previous?.getHours()).toBe(3)
    expect(isCronDue('0 3 * * *', null, now)).toBe(true)
    expect(isCronDue('0 3 * * *', previous!.toISOString(), now)).toBe(false)
    const later = new Date(2026, 10, 23, 10, 0, 0, 0)
    expect(isCronDue('0 3 * * *', null, later)).toBe(false)
  })
})
