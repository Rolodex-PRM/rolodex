import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const migrationsFolder =
  process.env.DRIZZLE_MIGRATIONS_FOLDER ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

const client = postgres(url, { max: 1 })
try {
  await migrate(drizzle(client), { migrationsFolder })
} finally {
  await client.end()
}
