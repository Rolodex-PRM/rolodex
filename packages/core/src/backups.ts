import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs'
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { activities, attachments, contacts, notes, relationships, users, workspaces, type Database } from '@rolodex/db'
import { count, isNotNull, isNull } from 'drizzle-orm'
import { assertCron, cronFromIntervalHours, DEFAULT_BACKUP_CRON, isCronDue } from './cron'
import { AppError } from './errors'
import { readSettings, writeSettings } from './server-store'
import { listWorkspaces } from './workspaces'

export const BACKUP_FORMAT_VERSION = 1
export const DATABASE_ARTIFACT = 'database.dump'
export const UPLOADS_ARTIFACT = 'uploads.tar.gz'
export const MANIFEST_NAME = 'manifest.json'
export const CHECKSUMS_NAME = 'checksums.sha256'

const policyKey = 'backups'
const defaultPolicy = {
  enabled: false,
  cron: DEFAULT_BACKUP_CRON,
  retain: 7,
  lastRunAt: null as string | null,
}

export type BackupPolicy = {
  enabled: boolean
  cron: string
  retain: number
  lastRunAt: string | null
}

export type BackupStats = {
  users: number
  workspaces: number
  contacts: number
  trashedContacts: number
  interactions: number
  notes: number
  relationships: number
  attachments: number
}

export type BackupSummary = {
  id: string
  createdAt: string
  sizeBytes: number
  applicationVersion: string
  formatVersion: number
  stats: BackupStats | null
}

export function dataRoot() {
  return process.env.DATA_DIR?.trim() || path.join(process.cwd(), '.data')
}

export function backupsRoot() {
  const configured = process.env.BACKUP_DIR?.trim()
  if (configured) return path.resolve(configured)
  return path.join(dataRoot(), 'backups')
}

export async function requireBackupOwner(db: Database, userId: string) {
  const workspaces = await listWorkspaces(db, userId)
  if (!workspaces.some((workspace) => workspace.role === 'owner')) {
    throw new AppError(403, 'Only an owner can manage backups')
  }
}

export async function backupPolicy(db: Database): Promise<BackupPolicy> {
  const stored = await readSettings(db, policyKey, defaultPolicy as unknown as Record<string, unknown>)
  const retain = Number(stored.retain)
  let cron = typeof stored.cron === 'string' ? stored.cron : ''
  if (!cron && typeof stored.intervalHours === 'number') {
    cron = cronFromIntervalHours(Number(stored.intervalHours))
  }
  try {
    cron = assertCron(cron || DEFAULT_BACKUP_CRON)
  } catch {
    cron = DEFAULT_BACKUP_CRON
  }
  return {
    enabled: stored.enabled === true,
    cron,
    retain: Number.isInteger(retain) && retain >= 1 && retain <= 100 ? retain : defaultPolicy.retain,
    lastRunAt: typeof stored.lastRunAt === 'string' ? stored.lastRunAt : null,
  }
}

export async function setBackupPolicy(
  db: Database,
  userId: string,
  input: { enabled: boolean; cron: string; retain: number },
) {
  await requireBackupOwner(db, userId)
  const current = await backupPolicy(db)
  let cron: string
  try {
    cron = assertCron(input.cron)
  } catch (error) {
    throw new AppError(400, error instanceof Error ? error.message : 'Invalid cron schedule')
  }
  const next: BackupPolicy = {
    enabled: input.enabled,
    cron,
    retain: Math.min(100, Math.max(1, Math.floor(input.retain))),
    lastRunAt: current.lastRunAt,
  }
  await writeSettings(db, policyKey, next)
  return next
}

export function listBackupSummaries(): BackupSummary[] {
  const root = backupsRoot()
  if (!existsSync(root)) return []
  const rows: BackupSummary[] = []
  for (const name of readdirSync(root)) {
    if (name.endsWith('.partial')) continue
    const dir = path.join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      const manifestPath = path.join(dir, MANIFEST_NAME)
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        format_version?: number
        created_at?: string
        application_version?: string
        stats?: unknown
      }
      if (manifest.format_version !== BACKUP_FORMAT_VERSION) continue
      rows.push({
        id: name,
        createdAt: typeof manifest.created_at === 'string' ? manifest.created_at : new Date(0).toISOString(),
        sizeBytes: directorySize(dir),
        applicationVersion: typeof manifest.application_version === 'string' ? manifest.application_version : 'unknown',
        formatVersion: BACKUP_FORMAT_VERSION,
        stats: parseBackupStats(manifest.stats),
      })
    } catch {
      // skip unreadable entries
    }
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function createCompleteBackup(db: Database, userId?: string) {
  if (userId) await requireBackupOwner(db, userId)
  const stamp = newStamp()
  const root = backupsRoot()
  mkdirSync(root, { recursive: true })
  restrictBackupPermissions(root)
  const finalDir = path.join(root, stamp)
  const partialDir = path.join(root, `${stamp}.partial`)
  if (existsSync(finalDir) || existsSync(partialDir)) {
    throw new AppError(409, 'A backup with this stamp already exists')
  }
  mkdirSync(partialDir, { recursive: true })
  restrictBackupPermissions(partialDir)
  try {
    const stats = await collectBackupStats(db)
    const dumpPath = path.join(partialDir, DATABASE_ARTIFACT)
    await runPgDump(dumpPath)
    const uploadsPath = path.join(partialDir, UPLOADS_ARTIFACT)
    await archiveUploads(uploadsPath)
    const createdAt = new Date().toISOString()
    const appVersion = applicationVersion()
    const pgVersion = await postgresVersion()
    writeManifest(partialDir, { createdAt, appVersion, pgVersion, stats })
    writeChecksums(partialDir)
    restrictBackupPermissions(partialDir)
    renameSync(partialDir, finalDir)
    restrictBackupPermissions(finalDir)
    const policy = await backupPolicy(db)
    await applyRetention(db, policy.retain)
    await writeSettings(db, policyKey, { ...policy, lastRunAt: createdAt })
    return listBackupSummaries().find((row) => row.id === stamp)!
  } catch (error) {
    rmSync(partialDir, { recursive: true, force: true })
    throw error
  }
}

export async function deleteBackup(db: Database, userId: string, id: string) {
  await requireBackupOwner(db, userId)
  const dir = backupDir(id)
  rmSync(dir, { recursive: true, force: true })
  return { ok: true }
}

export function backupArchivePath(id: string) {
  const dir = backupDir(id)
  return { dir, database: path.join(dir, DATABASE_ARTIFACT), uploads: path.join(dir, UPLOADS_ARTIFACT) }
}

export async function createBackupDownloadStream(id: string) {
  const dir = backupDir(id)
  assertBackupComplete(dir)
  const staging = await mkdtemp(path.join(tmpdir(), 'rolodex-backup-dl-'))
  const archive = path.join(staging, `${id}.tar.gz`)
  await runCommand('tar', ['-C', dir, '-czf', archive, DATABASE_ARTIFACT, UPLOADS_ARTIFACT, MANIFEST_NAME, CHECKSUMS_NAME])
  return {
    archive,
    filename: `rolodex-${id}.tar.gz`,
    cleanup: () => rmSync(staging, { recursive: true, force: true }),
  }
}

export async function importBackupArchive(db: Database, userId: string, archivePath: string) {
  await requireBackupOwner(db, userId)
  if (!existsSync(archivePath)) throw new AppError(400, 'Uploaded backup archive is missing')
  const staging = await mkdtemp(path.join(tmpdir(), 'rolodex-backup-up-'))
  try {
    const extractDir = path.join(staging, 'extract')
    mkdirSync(extractDir, { recursive: true })
    await runCommand('tar', ['-C', extractDir, '-xzf', archivePath])
    assertBackupComplete(extractDir)
    await assertArchivePathsSafe(path.join(extractDir, UPLOADS_ARTIFACT))
    const stamp = newStamp()
    const dest = path.join(backupsRoot(), stamp)
    mkdirSync(backupsRoot(), { recursive: true })
    restrictBackupPermissions(backupsRoot())
    mkdirSync(dest, { recursive: true })
    for (const name of [DATABASE_ARTIFACT, UPLOADS_ARTIFACT, MANIFEST_NAME, CHECKSUMS_NAME]) {
      copyFileSync(path.join(extractDir, name), path.join(dest, name))
    }
    restrictBackupPermissions(dest)
    const policy = await backupPolicy(db)
    await applyRetention(db, policy.retain)
    return listBackupSummaries().find((row) => row.id === stamp)!
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export async function restoreBackup(db: Database, userId: string, id: string) {
  await requireBackupOwner(db, userId)
  const dir = backupDir(id)
  assertBackupComplete(dir)
  verifyChecksums(dir)
  await assertArchivePathsSafe(path.join(dir, UPLOADS_ARTIFACT))
  await runPgRestore(path.join(dir, DATABASE_ARTIFACT))
  await restoreUploads(path.join(dir, UPLOADS_ARTIFACT))
  return { ok: true, restartSuggested: true }
}

export async function runScheduledBackups(db: Database) {
  const policy = await backupPolicy(db)
  if (!policy.enabled) return { ran: false }
  if (!isCronDue(policy.cron, policy.lastRunAt)) return { ran: false }
  await createCompleteBackup(db)
  return { ran: true }
}

async function applyRetention(_db: Database, retain: number) {
  const rows = listBackupSummaries()
  const extra = rows.slice(Math.max(0, retain))
  for (const row of extra) {
    rmSync(path.join(backupsRoot(), row.id), { recursive: true, force: true })
  }
}

function backupDir(id: string) {
  if (!/^\d{4}-\d{2}-\d{2}_\d{6}$/.test(id) && !/^uploaded-\d{4}-\d{2}-\d{2}_\d{6}$/.test(id)) {
    // allow stamped ids from newStamp and uploaded- prefix
    if (!/^[A-Za-z0-9._-]{8,80}$/.test(id) || id.includes('..') || id.includes('/') || id.includes('\\')) {
      throw new AppError(400, 'Invalid backup id')
    }
  }
  const dir = path.join(backupsRoot(), id)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new AppError(404, 'Backup not found')
  return dir
}

function newStamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
}

function applicationVersion() {
  const candidates = [
    path.join(process.cwd(), 'docs', 'version.json'),
    path.join(process.cwd(), 'package.json'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as { version?: string }
      if (json.version) return json.version
    } catch {
      // continue
    }
  }
  return process.env.npm_package_version || 'unknown'
}

async function collectBackupStats(db: Database): Promise<BackupStats> {
  const [
    [usersRow],
    [workspacesRow],
    [contactsRow],
    [trashedRow],
    [interactionsRow],
    [notesRow],
    [relationshipsRow],
    [attachmentsRow],
  ] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(workspaces),
    db.select({ value: count() }).from(contacts).where(isNull(contacts.deletedAt)),
    db.select({ value: count() }).from(contacts).where(isNotNull(contacts.deletedAt)),
    db.select({ value: count() }).from(activities).where(isNull(activities.deletedAt)),
    db.select({ value: count() }).from(notes).where(isNull(notes.deletedAt)),
    db.select({ value: count() }).from(relationships),
    db.select({ value: count() }).from(attachments),
  ])
  return {
    users: Number(usersRow?.value ?? 0),
    workspaces: Number(workspacesRow?.value ?? 0),
    contacts: Number(contactsRow?.value ?? 0),
    trashedContacts: Number(trashedRow?.value ?? 0),
    interactions: Number(interactionsRow?.value ?? 0),
    notes: Number(notesRow?.value ?? 0),
    relationships: Number(relationshipsRow?.value ?? 0),
    attachments: Number(attachmentsRow?.value ?? 0),
  }
}

function parseBackupStats(value: unknown): BackupStats | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const numberOr = (key: string, alt?: string) => {
    const raw = row[key] ?? (alt ? row[alt] : undefined)
    const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null
  }
  const usersCount = numberOr('users')
  const workspacesCount = numberOr('workspaces')
  const contactsCount = numberOr('contacts')
  const trashedCount = numberOr('trashed_contacts', 'trashedContacts')
  const interactionsCount = numberOr('interactions')
  const notesCount = numberOr('notes')
  const relationshipsCount = numberOr('relationships')
  const attachmentsCount = numberOr('attachments')
  if (
    usersCount === null ||
    workspacesCount === null ||
    contactsCount === null ||
    trashedCount === null ||
    interactionsCount === null ||
    notesCount === null ||
    relationshipsCount === null ||
    attachmentsCount === null
  ) {
    return null
  }
  return {
    users: usersCount,
    workspaces: workspacesCount,
    contacts: contactsCount,
    trashedContacts: trashedCount,
    interactions: interactionsCount,
    notes: notesCount,
    relationships: relationshipsCount,
    attachments: attachmentsCount,
  }
}

function writeManifest(
  dir: string,
  input: { createdAt: string; appVersion: string; pgVersion: string; stats: BackupStats },
) {
  const body = {
    format_version: BACKUP_FORMAT_VERSION,
    application: 'rolodex',
    application_version: input.appVersion,
    created_at: input.createdAt,
    postgres_version: input.pgVersion,
    stats: {
      users: input.stats.users,
      workspaces: input.stats.workspaces,
      contacts: input.stats.contacts,
      trashed_contacts: input.stats.trashedContacts,
      interactions: input.stats.interactions,
      notes: input.stats.notes,
      relationships: input.stats.relationships,
      attachments: input.stats.attachments,
    },
    components: {
      database: { file: DATABASE_ARTIFACT, format: 'postgres-custom' },
      uploads: { file: UPLOADS_ARTIFACT },
    },
  }
  writeFileSync(path.join(dir, MANIFEST_NAME), `${JSON.stringify(body, null, 2)}\n`)
}

function writeChecksums(dir: string) {
  const lines: string[] = []
  for (const name of [DATABASE_ARTIFACT, UPLOADS_ARTIFACT, MANIFEST_NAME]) {
    const hash = sha256File(path.join(dir, name))
    lines.push(`${hash}  ${name}`)
  }
  writeFileSync(path.join(dir, CHECKSUMS_NAME), `${lines.join('\n')}\n`)
}

function restrictBackupPermissions(dir: string) {
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Windows and some bind mounts ignore Unix modes.
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    try {
      if (statSync(full).isFile()) chmodSync(full, 0o600)
    } catch {
      // ignore
    }
  }
}

function verifyChecksums(dir: string) {
  const text = readFileSync(path.join(dir, CHECKSUMS_NAME), 'utf8')
  for (const line of text.split('\n').map((row) => row.trim()).filter(Boolean)) {
    const [hash, file] = line.split(/\s+/, 2)
    if (!hash || !file || file.includes('/') || file.includes('..')) throw new AppError(400, 'Invalid checksum file')
    const actual = sha256File(path.join(dir, file))
    if (actual !== hash) throw new AppError(400, `Checksum mismatch for ${file}`)
  }
}

function assertBackupComplete(dir: string) {
  for (const name of [DATABASE_ARTIFACT, UPLOADS_ARTIFACT, MANIFEST_NAME, CHECKSUMS_NAME]) {
    if (!existsSync(path.join(dir, name))) throw new AppError(400, `Backup is missing ${name}`)
  }
  const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')) as { format_version?: number }
  if (manifest.format_version !== BACKUP_FORMAT_VERSION) {
    throw new AppError(400, `Unsupported backup format_version ${manifest.format_version}`)
  }
}

function assertArchivePathsSafe(archive: string) {
  // List via tar; reject absolute paths and ..
  return runCommand('tar', ['-tzf', archive]).then((listing) => {
    for (const entry of listing.split('\n').map((row) => row.trim()).filter(Boolean)) {
      if (entry.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(entry)) {
        throw new AppError(400, `Unsafe path in uploads archive: ${entry}`)
      }
    }
  })
}

function sha256File(file: string) {
  const hash = createHash('sha256')
  hash.update(readFileSync(file))
  return hash.digest('hex')
}

function directorySize(dir: string) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const info = statSync(full)
    if (info.isFile()) total += info.size
  }
  return total
}

function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) throw new AppError(500, 'DATABASE_URL is not configured')
  return url
}

function runPgDump(outFile: string) {
  return runCommand('pg_dump', ['--dbname', databaseUrl(), '-Fc', '--clean', '--if-exists', '--no-owner', '--no-acl', '-f', outFile])
}

function runPgRestore(dumpFile: string) {
  return runCommand(
    'pg_restore',
    ['--dbname', databaseUrl(), '--clean', '--if-exists', '--no-owner', '--no-acl', dumpFile],
    { allowExitOne: true },
  )
}

async function archiveUploads(outFile: string) {
  const root = dataRoot()
  mkdirSync(root, { recursive: true })
  await runCommand('tar', ['-C', root, '--exclude=backups', '-czf', outFile, '.'])
}

async function restoreUploads(archive: string) {
  await assertArchivePathsSafe(archive)
  const root = dataRoot()
  mkdirSync(root, { recursive: true })
  for (const name of readdirSync(root)) {
    if (name === 'backups') continue
    rmSync(path.join(root, name), { recursive: true, force: true })
  }
  await runCommand('tar', ['-C', root, '-xzf', archive])
}

async function postgresVersion() {
  try {
    const out = await runCommand('psql', ['--dbname', databaseUrl(), '-At', '-c', 'SHOW server_version'])
    return out.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function runCommand(command: string, args: string[], options?: { allowExitOne?: boolean }) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(new AppError(501, `${command} is not available (${error.message})`))
    })
    child.on('close', (code) => {
      if (code === 0 || (options?.allowExitOne && code === 1)) {
        resolve(stdout)
        return
      }
      reject(new AppError(500, stderr.trim() || `${command} failed with exit ${code}`))
    })
  })
}

export async function streamFile(file: string, destination: NodeJS.WritableStream) {
  await pipeline(createReadStream(file), destination)
}

export async function backupExists(id: string) {
  try {
    await stat(path.join(backupsRoot(), id))
    return true
  } catch {
    return false
  }
}

export async function listBackupIds() {
  try {
    return await readdir(backupsRoot())
  } catch {
    return []
  }
}
