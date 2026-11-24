/** Minimal 5-field cron (minute hour day-of-month month day-of-week). */

const FIELD_MAX = [59, 23, 31, 12, 7] as const
const FIELD_MIN = [0, 0, 1, 1, 0] as const

export type CronFields = [string, string, string, string, string]

export function splitCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('Cron must have five fields: minute hour day month weekday')
  return parts as CronFields
}

export function joinCron(fields: CronFields) {
  return fields.join(' ')
}

export function assertCron(expression: string) {
  const fields = splitCron(expression)
  fields.forEach((field, index) => {
    for (const value of expandField(field, FIELD_MIN[index]!, FIELD_MAX[index]!)) {
      if (index === 4 && value === 7) continue
      if (value < FIELD_MIN[index]! || value > FIELD_MAX[index]!) {
        throw new Error(`Cron field ${index + 1} is out of range`)
      }
    }
  })
  return joinCron(fields)
}

function expandField(field: string, min: number, max: number): number[] {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart ? Number(stepPart) : 1
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step in "${field}"`)
    let start = min
    let end = max
    if (rangePart === '*') {
      start = min
      end = max
    } else if (rangePart?.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number)
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Invalid cron range in "${field}"`)
      start = a!
      end = b!
    } else {
      const single = Number(rangePart)
      if (!Number.isInteger(single)) throw new Error(`Invalid cron value in "${field}"`)
      start = single
      end = single
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return [...values].sort((a, b) => a - b)
}

function matchesField(field: string, value: number, min: number, max: number) {
  const expanded = expandField(field, min, max)
  if (max === 7 && expanded.includes(7) && value === 0) return true
  return expanded.includes(value)
}

export function cronMatches(expression: string, date: Date) {
  const [minute, hour, day, month, weekday] = splitCron(expression)
  // Server local timezone — matches how most self-hosted admins think about schedules.
  return (
    matchesField(minute!, date.getMinutes(), 0, 59) &&
    matchesField(hour!, date.getHours(), 0, 23) &&
    matchesField(day!, date.getDate(), 1, 31) &&
    matchesField(month!, date.getMonth() + 1, 1, 12) &&
    matchesField(weekday!, date.getDay(), 0, 7)
  )
}

export function nextCronRuns(expression: string, from: Date, count: number): Date[] {
  assertCron(expression)
  const runs: Date[] = []
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  // Cap search to ~2 years of minutes
  for (let i = 0; i < 60 * 24 * 400 && runs.length < count; i += 1) {
    if (cronMatches(expression, cursor)) runs.push(new Date(cursor.getTime()))
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return runs
}

export function previousCronRun(expression: string, before: Date): Date | null {
  assertCron(expression)
  const cursor = new Date(before.getTime())
  cursor.setSeconds(0, 0)
  for (let i = 0; i < 60 * 24 * 400; i += 1) {
    cursor.setMinutes(cursor.getMinutes() - 1)
    if (cronMatches(expression, cursor)) return new Date(cursor.getTime())
  }
  return null
}

export function isCronDue(expression: string, lastRunAt: string | null, now = new Date()) {
  const previous = previousCronRun(expression, now)
  if (!previous) return false
  if (!lastRunAt) {
    // On first enable, only fire if we just passed a scheduled minute (avoid catching up a backlog).
    return now.getTime() - previous.getTime() < 20 * 60 * 1000
  }
  return previous.getTime() > Date.parse(lastRunAt)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describeList(values: number[], labels?: string[]) {
  if (labels) return values.map((value) => labels[value] ?? String(value)).join(', ')
  return values.join(', ')
}

function describeField(field: string, kind: 'minute' | 'hour' | 'day' | 'month' | 'weekday') {
  if (field === '*') return 'every'
  if (field === '*/6' && kind === 'hour') return 'every 6 hours'
  if (field === '*/12' && kind === 'hour') return 'every 12 hours'
  if (field === '1-5' && kind === 'weekday') return 'Mon through Fri'
  if (field === '0' && kind === 'weekday') return 'Sunday'
  if (field === '6' && kind === 'weekday') return 'Saturday'
  if (kind === 'weekday') {
    try {
      return describeList(expandField(field, 0, 7).map((value) => (value === 7 ? 0 : value)), WEEKDAYS)
    } catch {
      return field
    }
  }
  if (field.includes('/')) {
    const [base, step] = field.split('/')
    if (base === '*') return `every ${step} ${kind === 'minute' ? 'minutes' : kind === 'hour' ? 'hours' : kind + 's'}`
  }
  return field
}

export function describeCron(expression: string) {
  try {
    const [minute, hour, day, month, weekday] = splitCron(expression)
    const parts: string[] = []
    if (minute === '0' && hour !== '*' && !hour?.includes('/') && /^\d+$/.test(hour || '')) {
      const hourNum = Number(hour)
      const suffix = hourNum >= 12 ? 'PM' : 'AM'
      const display = hourNum % 12 === 0 ? 12 : hourNum % 12
      parts.push(`At ${display}:00 ${suffix}`)
    } else if (hour?.startsWith('*/')) {
      parts.push(`Every ${hour.slice(2)} hours at minute ${minute}`)
    } else {
      parts.push(`Minute ${describeField(minute!, 'minute')}, hour ${describeField(hour!, 'hour')}`)
    }
    if (weekday && weekday !== '*') parts.push(describeField(weekday, 'weekday'))
    else if (day && day !== '*') parts.push(`day ${day} of the month`)
    if (month && month !== '*') parts.push(`in month ${month}`)
    return parts.join(', ')
  } catch {
    return expression
  }
}

export function cronFromIntervalHours(hours: number) {
  if (hours === 6) return '0 */6 * * *'
  if (hours === 12) return '0 */12 * * *'
  if (hours === 168) return '0 3 * * 0'
  return '0 3 * * *'
}

export const DEFAULT_BACKUP_CRON = '0 3 * * *'
