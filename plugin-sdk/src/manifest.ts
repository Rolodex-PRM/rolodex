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
  /** Semver comparators this page supports, such as `>=0.1.0 <1.0.0`. Empty when the page does not say. */
  rolodex: string
}

export type RegistryEntry = PluginManifest & {
  repo: string
  path: string
  license: string
  /** Git tag of the GitHub release whose archive is installed. Empty for a page that already lives on the server. */
  release: string
  /** SHA-256 of the tag archive at archive/refs/tags/<release>.zip. */
  sha256: string
  /** Ignored. The server downloads the tag archive. */
  asset: string
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
  const rolodex = readRolodex(record.rolodex, problems)
  const structural = problems.some((problem) => !problem.startsWith('Drop the '))
  if (structural) return { manifest: null, problems }
  return { manifest: { id, name, version, description, entry, settings, permissions, rolodex }, problems }
}

/** A Rolodex range is one to four comparators joined by spaces or commas. A bare version means that version only. */
export function explainRolodexRange(value: string) {
  const range = value.trim()
  if (!range || range.length > 80) return ''
  const parts = range.split(/[\s,]+/).filter(Boolean)
  if (!parts.length || parts.length > 4) return ''
  if (parts.some((part) => !/^(?:>=|<=|>|<|=)?v?\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(part))) return ''
  return parts.join(' ')
}

function readRolodex(value: unknown, problems: string[]) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string') {
    problems.push('rolodex is a version range such as >=0.1.0 <1.0.0')
    return ''
  }
  const range = explainRolodexRange(value)
  if (!range) problems.push('rolodex is a version range such as >=0.1.0 <1.0.0')
  return range
}

function versionPoint(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function comparePoint(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left[index] ?? 0
    const rightPart = right[index] ?? 0
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/** True when every comparator in the range accepts `version`. */
export function rolodexRangeIncludes(range: string, version: string) {
  const cleaned = explainRolodexRange(range)
  const point = versionPoint(version)
  if (!cleaned || !point) return false
  for (const part of cleaned.split(' ')) {
    const match = part.match(/^(>=|<=|>|<|=)?v?(\d+)\.(\d+)\.(\d+)$/)
    if (!match) return false
    const operator = match[1] || '='
    const target: [number, number, number] = [Number(match[2]), Number(match[3]), Number(match[4])]
    const order = comparePoint(point, target)
    if (operator === '=' && order !== 0) return false
    if (operator === '>' && order <= 0) return false
    if (operator === '>=' && order < 0) return false
    if (operator === '<' && order >= 0) return false
    if (operator === '<=' && order > 0) return false
  }
  return true
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
  const release = text(record.release)
  const sha256 = text(record.sha256).toLowerCase()
  const asset = text(record.asset) || 'plugin.zip'
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) problems.push('repo is owner/name')
  if (folder && !safeRepoPath(folder)) problems.push('path is a folder inside the repository')
  if (license.length > 60) problems.push('license stays under 60 characters')
  if (explained.manifest && !explained.manifest.rolodex) problems.push('rolodex is a version range such as >=0.1.0 <1.0.0')
  if (release || sha256) {
    if (!/^v?\d+\.\d+\.\d+(?:[+-][A-Za-z0-9.-]+)?$/.test(release)) problems.push('release is a version tag')
    if (!/^[a-f0-9]{64}$/.test(sha256)) problems.push('sha256 is the release archive hash')
    if (!/^[A-Za-z0-9._-]+\.zip$/.test(asset)) problems.push('asset is a zip file name')
  }
  if (!explained.manifest || problems.length > explained.problems.length) return { entry: null, problems }
  return {
    entry: { ...explained.manifest, repo, path: folder, license, release, sha256, asset },
    problems,
  }
}
