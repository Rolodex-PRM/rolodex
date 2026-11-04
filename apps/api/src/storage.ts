import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const bucket = () => process.env.S3_BUCKET || 'rolodex'

export type DiskStorage = { kind: 'disk'; root: string }
export type Storage = S3Client | DiskStorage

export function objectStorage(): Storage {
  const endpoint = process.env.S3_ENDPOINT?.trim()
  if (!endpoint) return { kind: 'disk', root: process.env.DATA_DIR || '/data' }
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'rolodex',
      secretAccessKey: process.env.S3_SECRET_KEY || 'rolodexsecret',
    },
  })
}

function isDisk(storage: Storage): storage is DiskStorage {
  return 'kind' in storage && storage.kind === 'disk'
}

function diskPath(storage: DiskStorage, key: string) {
  const root = resolve(storage.root)
  const path = resolve(root, key)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (path !== root && !path.startsWith(prefix)) throw new Error('Invalid object key')
  return path
}

export async function ensureBucket(storage: Storage) {
  if (isDisk(storage)) {
    await mkdir(storage.root, { recursive: true })
    return
  }
  try {
    await storage.send(new HeadBucketCommand({ Bucket: bucket() }))
  } catch {
    await storage.send(new CreateBucketCommand({ Bucket: bucket() }))
  }
}

export async function putObject(storage: Storage, key: string, body: Buffer, contentType: string) {
  if (isDisk(storage)) {
    const path = diskPath(storage, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    await writeFile(`${path}.type`, contentType)
    return
  }
  await storage.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }))
}

export async function getObject(storage: Storage, key: string) {
  if (isDisk(storage)) {
    const path = diskPath(storage, key)
    const bytes = await readFile(path)
    const contentType = await readFile(`${path}.type`, 'utf8').catch(() => 'application/octet-stream')
    return { bytes, contentType }
  }
  const result = await storage.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  const bytes = await result.Body?.transformToByteArray()
  if (!bytes) throw new Error('Empty object')
  return { bytes: Buffer.from(bytes), contentType: result.ContentType || 'application/octet-stream' }
}

export async function deleteObject(storage: Storage, key: string) {
  if (isDisk(storage)) {
    const path = diskPath(storage, key)
    await rm(path, { force: true })
    await rm(`${path}.type`, { force: true })
    return
  }
  await storage.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
}

export function photoKey(workspaceId: string, contactId: string, filename: string) {
  return fileKey(workspaceId, `contacts/${contactId}`, filename)
}

export function fileKey(workspaceId: string, scope: string, filename: string) {
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file'
  return `workspaces/${workspaceId}/${scope}/${randomUUID()}-${safe}`
}
