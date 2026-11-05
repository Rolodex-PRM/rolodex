import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contacts, pluginRecords, users, workspacePlugins, type Database } from '@rolodex/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { requireManager, requireMembership } from './access'
import { visibleContactSql } from './contacts'
import { AppError } from './errors'

export type PluginSummary = {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
}

type DiscoveredPlugin = Omit<PluginSummary, 'enabled'> & { entryPath: string }

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
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
    contacts: function () { return call('contacts.list') },
    me: function () { return call('me') },
    get: function (key) { return call('storage.get', { key: key }) },
    set: function (key, value) { return call('storage.set', { key: key, value: value }) }
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
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const version = typeof record.version === 'string' ? record.version.trim() : ''
  const description = typeof record.description === 'string' ? record.description.trim() : ''
  const entry = typeof record.entry === 'string' && record.entry.trim() ? record.entry.trim() : 'index.html'
  if (!idPattern.test(id) || id.length > 40) return null
  if (!name || name.length > 40 || !version || version.length > 20 || description.length > 200) return null
  if (!/^[a-z0-9.-]+\.html$/i.test(entry)) return null
  const entryPath = path.resolve(dir, entry)
  const root = path.resolve(dir)
  if (entryPath !== root && !entryPath.startsWith(root + path.sep)) return null
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) return null
  return { id, name, version, description, entryPath }
}

export function composePluginDocument(source: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; connect-src 'none'">`
  let html = /<html[\s>]/i.test(source) ? source : `<!doctype html><html><head></head><body>${source}</body></html>`
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${csp}`) : html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${csp}</head>`)
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridge}</body>`) : `${html}${bridge}`
}

export async function listWorkspacePlugins(db: Database, userId: string, workspaceId: string) {
  const member = await requireMembership(db, userId, workspaceId)
  const enabled = new Set(
    (await db.select().from(workspacePlugins).where(and(eq(workspacePlugins.workspaceId, workspaceId), eq(workspacePlugins.enabled, true)))).map((row) => row.pluginId),
  )
  const plugins = discoverPlugins().map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    enabled: enabled.has(plugin.id),
  }))
  const manager = member.role === 'owner' || member.role === 'administrator'
  return {
    plugins: manager ? plugins : plugins.filter((plugin) => plugin.enabled),
    directories: manager ? pluginDirectories() : [],
  }
}

export async function setWorkspacePlugin(db: Database, userId: string, workspaceId: string, pluginId: string, enabled: boolean) {
  await requireManager(db, userId, workspaceId)
  const plugin = discoverPlugins().find((item) => item.id === pluginId)
  if (!plugin) throw new AppError(404, 'Plugin not found')
  await db
    .insert(workspacePlugins)
    .values({ workspaceId, pluginId, enabled })
    .onConflictDoUpdate({ target: [workspacePlugins.workspaceId, workspacePlugins.pluginId], set: { enabled } })
  return { id: plugin.id, name: plugin.name, version: plugin.version, description: plugin.description, enabled }
}

async function enabledPlugin(db: Database, userId: string, workspaceId: string, pluginId: string) {
  await requireMembership(db, userId, workspaceId)
  const plugin = discoverPlugins().find((item) => item.id === pluginId)
  if (!plugin) throw new AppError(404, 'Plugin not found')
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
  if (typeof value !== 'string' || !idPattern.test(value) || value.length > 40) throw new AppError(400, 'Use a short key made of letters, numbers, and dashes')
  return value
}

export async function callPlugin(db: Database, userId: string, workspaceId: string, pluginId: string, method: string, args: unknown) {
  await enabledPlugin(db, userId, workspaceId, pluginId)
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (method === 'me') {
    const [user] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1)
    return { displayName: user?.displayName ?? '' }
  }
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
