/** Client-side 5-field cron helpers for the backup schedule UI (server local time). */

export type CronFields = [string, string, string, string, string]

const FIELD_MAX = [59, 23, 31, 12, 7] as const
const FIELD_MIN = [0, 0, 1, 1, 0] as const
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const DEFAULT_BACKUP_CRON = '0 3 * * *'

export function splitCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('Cron must have five fields')
  return parts as CronFields
}

export function joinCron(fields: CronFields) {
  return fields.join(' ')
}

function expandField(field: string, min: number, max: number): number[] {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart ? Number(stepPart) : 1
    if (!Number.isInteger(step) || step < 1) throw new Error('Invalid step')
    let start = min
    let end = max
    if (rangePart === '*') {
      start = min
      end = max
    } else if (rangePart?.includes('-')) {
      const [a, b] = rangePart.split('-').map(Number)
      start = a!
      end = b!
    } else {
      start = Number(rangePart)
      end = start
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return [...values]
}

function matchesField(field: string, value: number, min: number, max: number) {
  const expanded = expandField(field, min, max)
  if (max === 7 && expanded.includes(7) && value === 0) return true
  return expanded.includes(value)
}

export function cronMatches(expression: string, date: Date) {
  const [minute, hour, day, month, weekday] = splitCron(expression)
  return (
    matchesField(minute!, date.getMinutes(), 0, 59) &&
    matchesField(hour!, date.getHours(), 0, 23) &&
    matchesField(day!, date.getDate(), 1, 31) &&
    matchesField(month!, date.getMonth() + 1, 1, 12) &&
    matchesField(weekday!, date.getDay(), 0, 7)
  )
}

export function nextCronRuns(expression: string, from: Date, count: number): Date[] {
  const runs: Date[] = []
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  for (let i = 0; i < 60 * 24 * 400 && runs.length < count; i += 1) {
    if (cronMatches(expression, cursor)) runs.push(new Date(cursor.getTime()))
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return runs
}

function describeField(field: string, kind: 'minute' | 'hour' | 'day' | 'month' | 'weekday') {
  if (field === '*') return 'every'
  if (field === '1-5' && kind === 'weekday') return 'Mon through Fri'
  if (kind === 'weekday') {
    try {
      return expandField(field, 0, 7)
        .map((value) => WEEKDAYS[value === 7 ? 0 : value] ?? String(value))
        .join(', ')
    } catch {
      return field
    }
  }
  if (field.startsWith('*/')) return `every ${field.slice(2)}`
  return field
}

export function describeCron(expression: string) {
  try {
    const [minute, hour, day, month, weekday] = splitCron(expression)
    const parts: string[] = []
    if (minute === '0' && hour && /^\d+$/.test(hour)) {
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

export function fieldHint(field: string, kind: 'minute' | 'hour' | 'day' | 'month' | 'weekday') {
  return describeField(field, kind)
}

export function assertCron(expression: string) {
  const fields = splitCron(expression)
  fields.forEach((field, index) => {
    expandField(field, FIELD_MIN[index]!, FIELD_MAX[index]!)
  })
  return joinCron(fields)
}
