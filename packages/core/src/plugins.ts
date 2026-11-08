import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contacts, pluginRecords, users, workspacePlugins, type Database } from '@rolodex/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { explainPluginManifest, isPluginId, isPluginMethod, parseRegistryEntry, rolodexRangeIncludes, type PluginPermission, type PluginSetting, type RegistryEntry } from '@rolodex/plugin-sdk'
import { requireManager, requireMembership } from './access'
import {
  getPluginRecord,
  listPluginFiles,
  listPluginRecords,
  putPluginFile,
  putPluginRecords,
  queryPluginContacts,
  readPluginFile,
  removePluginFile,
  removePluginRecord,
  suggestForPlugin,
} from './plugin-host'
import { visibleContactSql } from './contacts'
import { AppError } from './errors'
import { installRegistryReleases, releasePluginRoot, rolodexVersion } from './plugin-release'

export type { PluginSetting }

export type PluginSummary = {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  settings: PluginSetting[]
  permissions: PluginPermission[]
  values: Record<string, string>
  present: boolean
  listed: boolean
  rolodex: string
  compatible: boolean
}

type DiscoveredPlugin = Omit<PluginSummary, 'enabled' | 'values' | 'present' | 'listed'> & { entryPath: string }

const bridge = `
<script>
(function () {
  if (window.rolodex) return
  var pending = new Map()
  var announced = false
  function announce() {
    if (!announced) parent.postMessage({ type: 'rolodex:ready' }, '*')
  }
  announce()
  var timer = setInterval(announce, 300)
  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data) return
    if (data.type === 'rolodex:context') {
      announced = true
      clearInterval(timer)
      if (window.rolodex) window.rolodex.contactId = data.contactId || null
      window.dispatchEvent(new Event('rolodex'))
      return
    }
    var waiter = data.id && pending.get(data.id)
    if (!waiter) return
    pending.delete(data.id)
    if (data.error) waiter.reject(new Error(data.error))
    else waiter.resolve(data.result)
  })
  function call(method, args) {
    var id = Math.random().toString(36).slice(2)
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject })
      parent.postMessage({ type: 'rolodex:invoke', id: id, method: method, args: args || {} }, '*')
    })
  }
  window.rolodex = {
    contactId: null,
    contacts: function () { return call('contacts.list') },
    me: function () { return call('me') },
    get: function (key) { return call('storage.get', { key: key }) },
    set: function (key, value) { return call('storage.set', { key: key, value: value }) },
    settings: function () { return call('settings') },
    contactsPage: function (offset) { return call('contacts.query', { offset: offset || 0 }) },
    records: {
      list: function (collection, offset) { return call('records.list', { collection: collection, offset: offset || 0 }) },
      get: function (collection, id) { return call('records.get', { collection: collection, id: id }) },
      put: function (collection, body, id) { return call('records.put', { collection: collection, body: body, id: id }) },
      remove: function (collection, id) { return call('records.remove', { collection: collection, id: id }) }
    },
    files: {
      put: function (file) { return call('files.put', file || {}) },
      list: function () { return call('files.list') },
      get: function (id) { return call('files.get', { id: id }) },
      download: function (id, filename) { return call('files.download', { id: id, filename: filename || '' }) }
    },
    suggest: function (prompt) { return call('ai.suggest', { prompt: prompt }) }
  }
})()
</script>`

export function pluginDirectories() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../../plugins'),
    path.resolve(process.cwd(), 'plugins'),
    path.resolve(process.cwd(), '../../plugins'),
    process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'plugins') : '',
    process.env.PLUGINS_DIR || '',
    releasePluginRoot(),
  ].filter(Boolean)
  return [...new Set(candidates)].filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
}

export function discoverPlugins(roots = pluginDirectories()): DiscoveredPlugin[] {
  const found = new Map<string, DiscoveredPlugin>()
  for (const root of roots) {
    let names: string[] = []
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const dir = path.join(root, name)
      if (!statSync(dir).isDirectory()) continue
      const manifestPath = path.join(dir, 'rolodex-plugin.json')
      if (!existsSync(manifestPath)) continue
      const plugin = readManifest(dir, manifestPath)
      if (plugin) found.set(plugin.id, plugin)
    }
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function readManifest(dir: string, manifestPath: string): DiscoveredPlugin | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
  const explained = explainPluginManifest(parsed)
  if (!explained.manifest) return null
  const { id, name, version, description, entry, settings, permissions, rolodex } = explained.manifest
  const entryPath = path.resolve(dir, entry)
  const root = path.resolve(dir)
  if (entryPath !== root && !entryPath.startsWith(root + path.sep)) return null
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) return null
  return { id, name, version, description, settings, permissions, rolodex, compatible: !rolodex || rolodexRangeIncludes(rolodex, rolodexVersion()), entryPath }
}

export function registryDirectories() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../../registry/plugins'),
    path.resolve(process.cwd(), 'registry/plugins'),
    path.resolve(process.cwd(), '../../registry/plugins'),
  ]
  return [...new Set(candidates)].filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
}

export function readRegistry(dirs = registryDirectories()): RegistryEntry[] {
  const found = new Map<string, RegistryEntry>()
  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8'))
      } catch {
        continue
      }
      const result = parseRegistryEntry(parsed)
      if (result.entry && !result.problems.length) found.set(result.entry.id, result.entry)
    }
  }
  return [...found.values()]
}

function settingValues(settings: PluginSetting[], stored: unknown) {
  const source = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  return Object.fromEntries(settings.map((setting) => {
    const raw = source[setting.key]
    if (setting.type === 'boolean') return [setting.key, raw === true || raw === 'true' ? 'true' : 'false']
    return [setting.key, typeof raw === 'string' ? raw.slice(0, 200) : '']
  }))
}

export function composePluginDocument(source: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; connect-src 'none'">`
  let html = /<html[\s>]/i.test(source) ? source : `<!doctype html><html><head></head><body>${source}</body></html>`
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${csp}`) : html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${csp}</head>`)
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridge}</body>`) : `${html}${bridge}`
}

function presentPlugin(plugin: DiscoveredPlugin, enabled: boolean, stored: unknown, listed: boolean): PluginSummary {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    enabled,
    settings: plugin.settings,
    permissions: plugin.permissions,
    values: settingValues(plugin.settings, stored),
    present: true,
    listed,
    rolodex: plugin.rolodex,
    compatible: plugin.compatible,
  }
}

export async function listWorkspacePlugins(db: Database, userId: string, workspaceId: string) {
  const member = await requireMembership(db, userId, workspaceId)
  const saved = await db.select().from(workspacePlugins).where(eq(workspacePlugins.workspaceId, workspaceId))
  const enabled = new Set(saved.filter((row) => row.enabled).map((row) => row.pluginId))
  const stored = new Map(saved.map((row) => [row.pluginId, row.settings]))
  const registry = readRegistry()
  await installRegistryReleases(registry)
  const host = rolodexVersion()
  const listed = new Set(registry.map((entry) => entry.id))
  const discovered = discoverPlugins()
  const plugins = discovered.map((plugin) => presentPlugin(plugin, enabled.has(plugin.id), stored.get(plugin.id), listed.has(plugin.id)))
  const known = new Set(discovered.map((plugin) => plugin.id))
  for (const entry of registry) {
    if (known.has(entry.id)) continue
    plugins.push({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      enabled: false,
      settings: entry.settings,
      permissions: entry.permissions,
      values: settingValues(entry.settings, {}),
      present: false,
      listed: true,
      rolodex: entry.rolodex,
      compatible: rolodexRangeIncludes(entry.rolodex, host),
    })
  }
  plugins.sort((left, right) => left.name.localeCompare(right.name))
  const manager = member.role === 'owner' || member.role === 'administrator'
  return {
    plugins: manager ? plugins : plugins.filter((plugin) => plugin.enabled),
    directories: manager ? pluginDirectories() : [],
  }
}

export async function setWorkspacePlugin(db: Database, userId: string, workspaceId: string, pluginId: string, enabled: boolean) {
  await requireManager(db, userId, workspaceId)
  await installRegistryReleases(readRegistry().filter((entry) => entry.id === pluginId))
  const plugin = discoverPlugins().find((item) => item.id === pluginId)
  if (!plugin) throw new AppError(404, 'Plugin not found')
  if (!plugin.compatible) throw new AppError(400, 'This plugin is for a different Rolodex version')
  await db
    .insert(workspacePlugins)
    .values({ workspaceId, pluginId, enabled })
    .onConflictDoUpdate({ target: [workspacePlugins.workspaceId, workspacePlugins.pluginId], set: { enabled } })
  const [row] = await db
    .select({ settings: workspacePlugins.settings })
    .from(workspacePlugins)
    .where(and(eq(workspacePlugins.workspaceId, workspaceId), eq(workspacePlugins.pluginId, pluginId)))
    .limit(1)
  return presentPlugin(plugin, enabled, row?.settings, readRegistry().some((entry) => entry.id === plugin.id))
}

export async function updatePluginSettings(db: Database, userId: string, workspaceId: string, pluginId: string, input: unknown) {
  await requireManager(db, userId, workspaceId)
  const plugin = discoverPlugins().find((item) => item.id === pluginId)
  if (!plugin) throw new AppError(404, 'Plugin not found')
  if (!plugin.compatible) throw new AppError(400, 'This plugin is for a different Rolodex version')
  const [existing] = await db
    .select({ enabled: workspacePlugins.enabled })
    .from(workspacePlugins)
    .where(and(eq(workspacePlugins.workspaceId, workspaceId), eq(workspacePlugins.pluginId, pluginId), eq(workspacePlugins.enabled, true)))
    .limit(1)
  if (!existing) throw new AppError(400, 'Install the plugin before changing its settings')
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const values = settingValues(plugin.settings, source)
  await db
    .update(workspacePlugins)
    .set({ settings: values })
    .where(and(eq(workspacePlugins.workspaceId, workspaceId), eq(workspacePlugins.pluginId, pluginId)))
  return presentPlugin(plugin, true, values, readRegistry().some((entry) => entry.id === plugin.id))
}

async function enabledPlugin(db: Database, userId: string, workspaceId: string, pluginId: string) {
  await requireMembership(db, userId, workspaceId)
  const plugin = discoverPlugins().find((item) => item.id === pluginId)
  if (!plugin) throw new AppError(404, 'Plugin not found')
  if (!plugin.compatible) throw new AppError(403, 'This plugin is for a different Rolodex version')
  const [row] = await db
    .select({ enabled: workspacePlugins.enabled })
    .from(workspacePlugins)
    .where(and(eq(workspacePlugins.workspaceId, workspaceId), eq(workspacePlugins.pluginId, pluginId), eq(workspacePlugins.enabled, true)))
    .limit(1)
  if (!row) throw new AppError(403, 'An administrator turns this plugin on')
  return plugin
}

export async function pluginDocument(db: Database, userId: string, workspaceId: string, pluginId: string) {
  const plugin = await enabledPlugin(db, userId, workspaceId, pluginId)
  const source = readFileSync(plugin.entryPath, 'utf8')
  if (source.length > 200_000) throw new AppError(400, 'Plugin page is too large')
  return { name: plugin.name, html: composePluginDocument(source) }
}

function recordKey(value: unknown) {
  if (typeof value !== 'string' || !isPluginId(value)) throw new AppError(400, 'Use a short key made of letters, numbers, and dashes')
  return value
}

export async function callPlugin(db: Database, userId: string, workspaceId: string, pluginId: string, method: string, args: unknown) {
  const plugin = await enabledPlugin(db, userId, workspaceId, pluginId)
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (!isPluginMethod(method)) throw new AppError(400, 'That plugin action is not available')
  if (method === 'settings') {
    const [row] = await db
      .select({ settings: workspacePlugins.settings })
      .from(workspacePlugins)
      .where(and(eq(workspacePlugins.workspaceId, workspaceId), eq(workspacePlugins.pluginId, pluginId)))
      .limit(1)
    const plugin = discoverPlugins().find((item) => item.id === pluginId)
    return settingValues(plugin?.settings ?? [], row?.settings)
  }
  if (method === 'me') {
    const [user] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1)
    return { displayName: user?.displayName ?? '' }
  }
  if (method === 'contacts.query') return queryPluginContacts(db, userId, workspaceId, plugin, record.offset)
  if (method === 'records.list') return listPluginRecords(db, userId, workspaceId, pluginId, plugin, record)
  if (method === 'records.get') return getPluginRecord(db, userId, workspaceId, pluginId, plugin, record)
  if (method === 'records.put') return putPluginRecords(db, userId, workspaceId, pluginId, plugin, record)
  if (method === 'records.remove') return removePluginRecord(db, userId, workspaceId, pluginId, plugin, record)
  if (method === 'files.put') return putPluginFile(db, userId, workspaceId, pluginId, plugin, record)
  if (method === 'files.list') return listPluginFiles(db, userId, workspaceId, pluginId, plugin)
  if (method === 'files.get') {
    const file = await readPluginFile(db, userId, workspaceId, pluginId, plugin, typeof record.id === 'string' ? record.id : '')
    return { id: file.id, filename: file.filename, contentType: file.contentType, data: file.content }
  }
  if (method === 'files.remove') return removePluginFile(db, userId, workspaceId, pluginId, plugin, record)
  if (method === 'ai.suggest') return suggestForPlugin(db, userId, workspaceId, plugin, record)
  if (method === 'contacts.list') {
    return db
      .select({ id: contacts.id, displayName: contacts.displayName })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), isNull(contacts.deletedAt), visibleContactSql(userId)))
      .orderBy(asc(contacts.displayName))
      .limit(200)
  }
  if (method === 'storage.get') {
    const key = recordKey(record.key)
    const [row] = await db
      .select({ value: pluginRecords.value })
      .from(pluginRecords)
      .where(and(eq(pluginRecords.workspaceId, workspaceId), eq(pluginRecords.userId, userId), eq(pluginRecords.pluginId, pluginId), eq(pluginRecords.recordKey, key)))
      .limit(1)
    return row?.value ?? null
  }
  if (method === 'storage.set') {
    const key = recordKey(record.key)
    if (typeof record.value !== 'string' || record.value.length > 8000) throw new AppError(400, 'Keep the saved text under 8000 characters')
    await db
      .insert(pluginRecords)
      .values({ workspaceId, userId, pluginId, recordKey: key, value: record.value })
      .onConflictDoUpdate({
        target: [pluginRecords.workspaceId, pluginRecords.userId, pluginRecords.pluginId, pluginRecords.recordKey],
        set: { value: record.value, updatedAt: new Date() },
      })
    return { ok: true }
  }
  throw new AppError(400, 'That plugin action is not available')
}

export async function downloadPluginFile(db: Database, userId: string, workspaceId: string, pluginId: string, fileId: string) {
  const plugin = await enabledPlugin(db, userId, workspaceId, pluginId)
  return readPluginFile(db, userId, workspaceId, pluginId, plugin, fileId)
}
