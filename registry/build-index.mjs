import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(root, 'plugins')
const entries = readdirSync(source)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(path.join(source, name), 'utf8')))
  .sort((left, right) => left.name.localeCompare(right.name))
mkdirSync(path.join(root, 'dist'), { recursive: true })
writeFileSync(path.join(root, 'dist', 'index.json'), `${JSON.stringify({ plugins: entries }, null, 2)}\n`)
console.log(`${entries.length} plugin${entries.length === 1 ? '' : 's'}`)
