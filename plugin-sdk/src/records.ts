const fileTypes = new Set([
  'text/csv',
  'text/plain',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export function pluginDocumentBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A record is an object')
  const body = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A record is an object')
  if (JSON.stringify(body).length > 100_000) throw new Error('Keep each record under 100000 characters')
  return body
}

export type PluginFilePayload = { filename: string; contentType: string; data: string }

export function pluginFilePayload(value: unknown): PluginFilePayload {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const filename = typeof row.filename === 'string' ? row.filename.trim() : ''
  const contentType = typeof row.contentType === 'string' ? row.contentType.trim().toLowerCase() : ''
  const data = typeof row.data === 'string' ? row.data.trim() : ''
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(filename)) throw new Error('Name the file with letters, numbers, dots, and dashes')
  if (!fileTypes.has(contentType)) throw new Error('Use a CSV, spreadsheet, PDF, JSON, or text file')
  if (!data || data.length > 5_600_000) throw new Error('Keep an export under 4 MB')
  return { filename, contentType, data }
}
