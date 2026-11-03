import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '@rolodex/db'
import { AppError } from './errors'
import { createFirstAdmin, setupRequired } from './auth'

for (const path of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (!existsSync(path)) continue
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match?.[1] && process.env[match[1]] == null) process.env[match[1]] = match[2] ?? ''
  }
}

const databaseUrl = process.env.DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('first administrator', () => {
  const { db, client } = createDb(databaseUrl || 'postgres://invalid')

  afterAll(async () => {
    await client.end()
  })

  it('stays closed once any account exists', async () => {
    const status = await setupRequired(db)
    expect(status.required).toBe(false)
    await expect(createFirstAdmin(db, { email: 'first-admin@example.com', password: 'correct-horse', displayName: 'Admin' })).rejects.toMatchObject({
      status: 409,
      message: 'This server already has an administrator',
    } satisfies Partial<AppError>)
  })
})
