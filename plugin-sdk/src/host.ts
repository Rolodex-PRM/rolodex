import { isPluginId, type PluginPermission } from './manifest'
import { pluginDocumentBody, pluginFilePayload } from './records'

export type PluginContact = { id: string; displayName: string }

type StoredRecord = { id: string; body: Record<string, unknown>; deleted: boolean }
type StoredFile = { id: string; filename: string; contentType: string; data: string }

export type PluginHost = {
  me: () => Promise<{ displayName: string }>
  contacts: () => Promise<PluginContact[]>
  contactsPage: (offset?: number) => Promise<{ contacts: PluginContact[]; total: number }>
  settings: () => Promise<Record<string, string>>
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<{ ok: true }>
  records: {
    list: (collection: string, offset?: number) => Promise<{ records: { id: string; body: Record<string, unknown> }[]; total: number }>
    get: (collection: string, id: string) => Promise<{ id: string; body: Record<string, unknown> }>
    put: (collection: string, body: Record<string, unknown>, id?: string) => Promise<{ id: string; body: Record<string, unknown> }>
    remove: (collection: string, id: string) => Promise<{ ok: true }>
  }
  files: {
    put: (file: { filename: string; contentType: string; data: string }) => Promise<{ id: string; filename: string }>
    list: () => Promise<{ id: string; filename: string; contentType: string }[]>
    get: (id: string) => Promise<StoredFile>
  }
  suggest: (prompt: string) => Promise<{ text: string }>
}

export type MockHostOptions = {
  displayName?: string
  contacts?: PluginContact[]
  settings?: Record<string, string>
  records?: Record<string, string>
  grants?: PluginPermission[]
  suggestions?: Record<string, string>
}

export function createMockHost(options: MockHostOptions = {}): PluginHost {
  const notes = { ...(options.records ?? {}) }
  const settings = { ...(options.settings ?? {}) }
  const contacts = [...(options.contacts ?? [])]
  const grants = new Set(options.grants ?? [])
  const documents = new Map<string, StoredRecord>()
  const files = new Map<string, StoredFile>()
  let sequence = 0

  function allow(permission: PluginPermission) {
    if (!grants.has(permission)) throw new Error('This plugin is not allowed to do that')
  }

  function collectionKey(collection: string, id: string) {
    if (!isPluginId(collection) || !isPluginId(id)) throw new Error('Use a short collection and record id')
    return `${collection}/${id}`
  }

  return {
    async me() {
      return { displayName: options.displayName ?? '' }
    },
    async contacts() {
      return contacts.map((contact) => ({ id: contact.id, displayName: contact.displayName }))
    },
    async contactsPage(offset = 0) {
      allow('contacts:read')
      const start = Math.max(0, offset)
      return { contacts: contacts.slice(start, start + 100).map((contact) => ({ ...contact })), total: contacts.length }
    },
    async settings() {
      return { ...settings }
    },
    async get(key) {
      if (!isPluginId(key)) throw new Error('Use a short key made of letters, numbers, and dashes')
      return notes[key] ?? null
    },
    async set(key, value) {
      if (!isPluginId(key)) throw new Error('Use a short key made of letters, numbers, and dashes')
      if (typeof value !== 'string' || value.length > 8000) throw new Error('Keep the saved text under 8000 characters')
      notes[key] = value
      return { ok: true }
    },
    records: {
      async list(collection, offset = 0) {
        allow('data:own')
        if (!isPluginId(collection)) throw new Error('Use a short collection and record id')
        const rows = [...documents.values()].filter((row) => row.id.startsWith(`${collection}/`) && !row.deleted)
        const start = Math.max(0, offset)
        return {
          records: rows.slice(start, start + 100).map((row) => ({ id: row.id.slice(collection.length + 1), body: { ...row.body } })),
          total: rows.length,
        }
      },
      async get(collection, id) {
        allow('data:own')
        const row = documents.get(collectionKey(collection, id))
        if (!row || row.deleted) throw new Error('Record not found')
        return { id, body: { ...row.body } }
      },
      async put(collection, body, id) {
        allow('data:own')
        const key = id && isPluginId(id) ? id : `record-${++sequence}`
        const saved = pluginDocumentBody(body)
        documents.set(collectionKey(collection, key), { id: `${collection}/${key}`, body: saved, deleted: false })
        return { id: key, body: saved }
      },
      async remove(collection, id) {
        allow('data:own')
        const key = collectionKey(collection, id)
        const row = documents.get(key)
        if (!row || row.deleted) throw new Error('Record not found')
        row.deleted = true
        return { ok: true }
      },
    },
    files: {
      async put(file) {
        allow('files:own')
        const payload = pluginFilePayload(file)
        const id = `file-${++sequence}`
        files.set(id, { id, ...payload })
        return { id, filename: payload.filename }
      },
      async list() {
        allow('files:own')
        return [...files.values()].map((file) => ({ id: file.id, filename: file.filename, contentType: file.contentType }))
      },
      async get(id) {
        allow('files:own')
        const file = files.get(id)
        if (!file) throw new Error('File not found')
        return { ...file }
      },
    },
    async suggest(prompt) {
      allow('ai:suggest')
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('Keep the question under 8000 characters')
      return { text: options.suggestions?.[prompt] ?? '' }
    },
  }
}
