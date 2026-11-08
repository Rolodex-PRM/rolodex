import { createHash, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { explainPluginManifest, rolodexRangeIncludes, type RegistryEntry } from '@rolodex/plugin-sdk'

const ARCHIVE_LIMIT = 2_000_000
const PAGE_LIMIT = 200_000

export type AddressLookup = (hostname: string) => Promise<string[]>

type InstallOptions = {
  root?: string
  version?: string
  fetch?: typeof fetch
  lookup?: AddressLookup
}

/** Directory where pinned releases are unpacked. Separate from folders an administrator copied by hand. */
export function releasePluginRoot() {
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'plugins')
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '../../../.data/plugins')
}

/** Version from the Rolodex package, without a leading v. */
export function rolodexVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const files = [
    path.resolve(here, '../../../package.json'),
    path.resolve(process.cwd(), 'package.json'),
    path.resolve(process.cwd(), '../../package.json'),
  ]
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string }
      if (parsed.name === 'rolodex' && parsed.version) return parsed.version.replace(/^v/, '')
    } catch {
      continue
    }
  }
  return '0.0.0'
}

/** Tag archive GitHub publishes for a release, before it redirects to codeload. */
export function releaseArchiveUrl(repo: string, release: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('repo is owner/name')
  if (!/^v?\d+\.\d+\.\d+(?:[+-][A-Za-z0-9.-]+)?$/.test(release)) throw new Error('release is a version tag')
  const [owner, name] = repo.split('/')
  if (!owner || !name) throw new Error('repo is owner/name')
  return `https://github.com/${owner}/${name}/archive/refs/tags/${encodeURIComponent(release)}.zip`
}

function releaseTarget(url: string) {
  const parsed = new URL(url)
  const match = decodeURIComponent(parsed.pathname).match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/archive\/refs\/tags\/(v?\d+\.\d+\.\d+(?:[+-][A-Za-z0-9.-]+)?)\.zip$/)
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || !match) return null
  return { owner: match[1] ?? '', name: match[2] ?? '', release: match[3] ?? '' }
}

function sameRelease(url: URL, target: { owner: string; name: string; release: string }) {
  const host = url.hostname.toLowerCase()
  const pathName = decodeURIComponent(url.pathname)
  const archive = `/${target.owner}/${target.name}/archive/refs/tags/${target.release}.zip`
  const codeload = `/${target.owner}/${target.name}/zip/refs/tags/${target.release}`
  if (host === 'github.com') return pathName === archive
  if (host === 'codeload.github.com') return pathName === codeload
  return false
}

export function isPrivateAddress(address: string) {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true
  const mapped = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip
  const parts = mapped.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return ip.includes(':') ? false : true
  const first = parts[0] ?? 0
  const second = parts[1] ?? 0
  if (first === 0 || first === 10 || first === 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  return false
}

async function defaultLookup(hostname: string) {
  const records = await lookup(hostname, { all: true })
  return records.map((record) => record.address)
}

async function assertPublicRelease(url: URL, resolve: AddressLookup) {
  if (url.protocol !== 'https:') throw new Error('The release address is not https')
  const addresses = await resolve(url.hostname)
  if (!addresses.length) throw new Error('The release address did not resolve')
  if (addresses.some((address) => isPrivateAddress(address))) throw new Error('The release address is not public')
}

export async function downloadRelease(url: string, options: InstallOptions = {}) {
  const target = releaseTarget(url)
  if (!target) throw new Error('The release address is not a GitHub release')
  const fetchImpl = options.fetch ?? fetch
  const resolve = options.lookup ?? defaultLookup
  let current = url
  const signal = AbortSignal.timeout(20_000)
  for (let hop = 0; hop < 5; hop += 1) {
    const parsed = new URL(current)
    if (!sameRelease(parsed, target)) throw new Error('The release address is not a GitHub release')
    await assertPublicRelease(parsed, resolve)
    const response = await fetchImpl(current, { redirect: 'manual', signal, headers: { 'User-Agent': 'Rolodex', Accept: 'application/octet-stream' } })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('The release redirected without an address')
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) throw new Error('The release could not be downloaded')
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > ARCHIVE_LIMIT) throw new Error('The release archive is too large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > ARCHIVE_LIMIT) throw new Error('The release archive is too large')
    return bytes
  }
  throw new Error('The release redirected too many times')
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const start = Math.max(0, bytes.length - 22 - 65_535)
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('The release archive is not a zip file')
}

function safeZipName(name: string) {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return ''
  const parts = normalized.split('/').filter((part) => part.length > 0)
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) return ''
  return parts.join('/')
}

/** Keep the manifest and HTML page. A single wrapping folder, as in a source archive, is removed. */
export function extractPluginZip(bytes: Buffer) {
  if (bytes.length < 22 || bytes.length > ARCHIVE_LIMIT) throw new Error('The release archive is the wrong size')
  const end = findEndOfCentralDirectory(bytes)
  const count = bytes.readUInt16LE(end + 10)
  const directorySize = bytes.readUInt32LE(end + 12)
  const directoryOffset = bytes.readUInt32LE(end + 16)
  if (count > 40) throw new Error('The release archive has too many files')
  if (directoryOffset + directorySize > bytes.length) throw new Error('The release archive is incomplete')
  const packed = new Map<string, Buffer>()
  let cursor = directoryOffset
  let total = 0
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('The release archive is incomplete')
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const compressed = bytes.readUInt32LE(cursor + 20)
    const uncompressed = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (flags & 1) throw new Error('The release archive is encrypted')
    if (method !== 0 && method !== 8) throw new Error('The release archive uses an unsupported compression')
    if (uncompressed > ARCHIVE_LIMIT) throw new Error('The release archive is too large')
    const safe = safeZipName(name)
    if (!safe) throw new Error('The release archive leaves its folder')
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('The release archive is incomplete')
    const localName = bytes.readUInt16LE(localOffset + 26)
    const localExtra = bytes.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localName + localExtra
    const slice = bytes.subarray(start, start + compressed)
    if (slice.length !== compressed) throw new Error('The release archive is incomplete')
    const data = method === 0 ? Buffer.from(slice) : inflateRawSync(slice)
    if (data.length !== uncompressed) throw new Error('The release archive expanded to an unexpected size')
    total += data.length
    if (total > ARCHIVE_LIMIT) throw new Error('The release archive is too large')
    packed.set(safe, data)
  }
  const names = [...packed.keys()]
  const tops = new Set(names.map((name) => name.split('/')[0]))
  const nested = names.length > 0 && names.every((name) => name.includes('/')) && tops.size === 1
  const files = new Map<string, Buffer>()
  for (const [name, data] of packed) {
    const relative = nested ? name.slice(name.indexOf('/') + 1) : name
    if (!relative || relative.includes('/')) continue
    if (relative !== 'rolodex-plugin.json' && !relative.endsWith('.html')) continue
    files.set(relative, data)
  }
  return files
}

function hashesMatch(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

const pending = new Map<string, Promise<void>>()

export function installRegistryRelease(entry: RegistryEntry, options: InstallOptions = {}) {
  if (!entry.release || !entry.sha256) return Promise.resolve()
  const key = `${options.root ?? ''}:${entry.id}:${entry.sha256}`
  const current = pending.get(key)
  if (current) return current
  const job = unpackRelease(entry, options).finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}

async function unpackRelease(entry: RegistryEntry, options: InstallOptions) {
  const version = options.version ?? rolodexVersion()
  if (!rolodexRangeIncludes(entry.rolodex, version)) return
  const root = options.root ?? releasePluginRoot()
  mkdirSync(root, { recursive: true })
  const destination = path.join(root, entry.id)
  const pinPath = path.join(destination, '.pin')
  const pinned = existsSync(pinPath) && readFileSync(pinPath, 'utf8').trim() === entry.sha256 && existsSync(path.join(destination, 'rolodex-plugin.json'))
  if (pinned) return
  if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
  const bytes = await downloadRelease(releaseArchiveUrl(entry.repo, entry.release), options)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (!hashesMatch(actual, entry.sha256)) throw new Error('The release does not match the registry pin')
  const files = extractPluginZip(bytes)
  const manifestBytes = files.get('rolodex-plugin.json')
  if (!manifestBytes) throw new Error('The release has no rolodex-plugin.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    throw new Error('The release manifest is not valid')
  }
  const explained = explainPluginManifest(parsed)
  if (!explained.manifest) throw new Error('The release manifest is not valid')
  const manifest = explained.manifest
  if (manifest.id !== entry.id || manifest.version !== entry.version || manifest.rolodex !== entry.rolodex) {
    throw new Error('The release does not match the registry entry')
  }
  const page = files.get(manifest.entry)
  if (!page || page.length === 0 || page.length > PAGE_LIMIT) throw new Error('The release page is missing')
  const staging = mkdtempSync(path.join(root, `.${entry.id}-`))
  try {
    writeFileSync(path.join(staging, 'rolodex-plugin.json'), manifestBytes)
    writeFileSync(path.join(staging, manifest.entry), page)
    writeFileSync(path.join(staging, '.pin'), `${entry.sha256}\n`)
    renameSync(staging, destination)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

export async function installRegistryReleases(entries: RegistryEntry[], options: InstallOptions = {}) {
  for (const entry of entries) {
    if (!entry.release || !entry.sha256) continue
    try {
      await installRegistryRelease(entry, options)
    } catch {
      continue
    }
  }
}
