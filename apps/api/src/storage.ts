import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { randomUUID } from 'node:crypto'

const bucket = () => process.env.S3_BUCKET || 'rolodex'

export function objectStorage() {
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || 'http://127.0.0.1:9000',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'rolodex',
      secretAccessKey: process.env.S3_SECRET_KEY || 'rolodexsecret',
    },
  })
}

export async function ensureBucket(client: S3Client) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket() }))
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket() }))
  }
}

export async function putObject(client: S3Client, key: string, body: Buffer, contentType: string) {
  await client.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }))
}

export async function getObject(client: S3Client, key: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  const bytes = await result.Body?.transformToByteArray()
  if (!bytes) throw new Error('Empty object')
  return { bytes: Buffer.from(bytes), contentType: result.ContentType || 'application/octet-stream' }
}

export async function deleteObject(client: S3Client, key: string) {
  await client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }))
}

export function photoKey(workspaceId: string, contactId: string, filename: string) {
  return fileKey(workspaceId, `contacts/${contactId}`, filename)
}

export function fileKey(workspaceId: string, scope: string, filename: string) {
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file'
  return `workspaces/${workspaceId}/${scope}/${randomUUID()}-${safe}`
}
