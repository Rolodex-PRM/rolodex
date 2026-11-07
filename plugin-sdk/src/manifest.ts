export type PluginSetting = { key: string; label: string; type: 'text' | 'boolean' }

export const pluginPermissions = ['contacts:read', 'data:own', 'files:own', 'ai:suggest', 'profile:section'] as const
export type PluginPermission = (typeof pluginPermissions)[number]

export type PluginManifest = {
  id: string
  name: string
  version: string
  description: string
  entry: string
  settings: PluginSetting[]
  permissions: PluginPermission[]
}

export type RegistryEntry = PluginManifest & {
  repo: string
  path: string
  license: string
}

export const pluginMethods = [
  'settings',
  'me',
  'contacts.list',
  'contacts.query',
  'storage.get',
  'storage.set',
  'records.list',
  'records.get',
  'records.put',
  'records.remove',
  'files.put',
  'files.list',
  'files.get',
  'files.remove',
  'ai.suggest',
] as const
export type PluginMethod = (typeof pluginMethods)[number]

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isPluginId(value: string) {
  return idPattern.test(value) && value.length <= 40
}

export function isPluginMethod(value: string): value is PluginMethod {
  return (pluginMethods as readonly string[]).includes(value)
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readSettings(value: unknown, problems: string[]) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push('settings must be a list')
    return []
  }
  const settings: PluginSetting[] = []
  if (value.length > 12) problems.push('Drop the settings after the first 12')
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') {
      problems.push('Each setting needs a key, a label, and a type')
      continue
    }
    const row = item as Record<string, unknown>
    const key = text(row.key)
    const label = text(row.label)
    const type = row.type === 'boolean' ? 'boolean' : row.type === 'text' ? 'text' : ''
    if (!isPluginId(key) || !label || label.length > 40 || !type) {
      problems.push(`Drop the setting ${key || '(missing key)'}: use a short key, a label, and type text or boolean`)
      continue
    }
    if (settings.some((setting) => setting.key === key)) {
      problems.push(`Drop the duplicate setting ${key}`)
      continue
    }
    settings.push({ key, label, type })
  }
  return settings
}

function readPermissions(value: unknown, problems: string[]) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    problems.push('permissions must be a list')
    return []
  }
  const granted: PluginPermission[] = []
  for (const item of value) {
    const name = text(item)
    if (!(pluginPermissions as readonly string[]).includes(name)) {
      problems.push(`Drop the permission ${name || '(missing)'}`)
      continue
    }
    const permission = name as PluginPermission
    if (!granted.includes(permission)) granted.push(permission)
  }
  return granted
}

export function explainPluginManifest(value: unknown): { manifest: PluginManifest | null; problems: string[] } {
  const problems: string[] = []
  if (!value || typeof value !== 'object') return { manifest: null, problems: ['rolodex-plugin.json must be an object'] }
  const record = value as Record<string, unknown>
  const id = text(record.id)
  const name = text(record.name)
  const version = text(record.version)
  const description = text(record.description)
  const entry = text(record.entry) || 'index.html'
  if (!isPluginId(id)) problems.push('id uses lowercase letters, numbers, and dashes, and stays under 40 characters')
  if (!name || name.length > 40) problems.push('name is required and stays under 40 characters')
  if (!version || version.length > 20) problems.push('version is required and stays under 20 characters')
  if (description.length > 200) problems.push('description stays under 200 characters')
  if (!/^[a-z0-9.-]+\.html$/i.test(entry)) problems.push('entry is one HTML file name in the plugin folder')
  const settings = readSettings(record.settings, problems)
  const permissions = readPermissions(record.permissions, problems)
  const structural = problems.some((problem) => !problem.startsWith('Drop the '))
  if (structural) return { manifest: null, problems }
  return { manifest: { id, name, version, description, entry, settings, permissions }, problems }
}

function safeRepoPath(value: string) {
  if (!value || value.length > 200 || value.startsWith('/') || value.includes('\\')) return false
  const parts = value.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

export function parseRegistryEntry(value: unknown): { entry: RegistryEntry | null; problems: string[] } {
  const explained = explainPluginManifest(value)
  const problems = [...explained.problems]
  if (!value || typeof value !== 'object') return { entry: null, problems }
  const record = value as Record<string, unknown>
  const repo = text(record.repo)
  const folder = text(record.path)
  const license = text(record.license)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) problems.push('repo is owner/name')
  if (!safeRepoPath(folder)) problems.push('path is a folder inside the repository')
  if (license.length > 60) problems.push('license stays under 60 characters')
  if (!explained.manifest || problems.length > explained.problems.length) return { entry: null, problems }
  return {
    entry: { ...explained.manifest, repo, path: folder, license },
    problems,
  }
}
