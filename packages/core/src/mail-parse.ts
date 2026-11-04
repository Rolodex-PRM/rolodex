export type FetchedMail = { uid: string; from: string; email: string; subject: string; occurredAt: Date }

export function parseFetchedHeaders(text: string): FetchedMail[] {
  const blocks = text.split(/(?:^|\r?\n)\* /)
  const messages: FetchedMail[] = []
  for (const block of blocks) {
    const uid = /UID (\d+)/i.exec(block)?.[1]
    const from = /^from:\s*(.+)$/im.exec(block)?.[1]?.trim()
    if (!uid || !from) continue
    const email = extractEmail(from)
    if (!email) continue
    const subject = decodeHeader(/^subject:\s*(.+)$/im.exec(block)?.[1]?.trim() || '(no subject)')
    const rawDate = /^date:\s*(.+)$/im.exec(block)?.[1]?.trim()
    const occurredAt = rawDate ? new Date(rawDate) : new Date()
    messages.push({
      uid,
      from,
      email,
      subject: subject.slice(0, 300),
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    })
  }
  return messages
}

export function extractEmail(value: string) {
  const wrapped = /<([^>]+)>/.exec(value)?.[1]
  const candidate = (wrapped || value).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : ''
}

function decodeHeader(value: string) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]+)\?=/gi, (_all, _charset: string, encoding: string, data: string) => {
    try {
      if (encoding.toLowerCase() === 'b') return Buffer.from(data, 'base64').toString('utf8')
      const text = data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
      return Buffer.from(text, 'binary').toString('utf8')
    } catch {
      return data
    }
  })
}

export function splitCalendarObjects(text: string) {
  return text
    .split(/BEGIN:VEVENT/i)
    .slice(1)
    .map((chunk) => `BEGIN:VEVENT${chunk.split(/END:VEVENT/i)[0]}END:VEVENT`)
}
