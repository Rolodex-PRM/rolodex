import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function load(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] != null) continue
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }
}

load(resolve(root, '.env'))
process.env.EXPO_PUBLIC_WEB_PORT ||= process.env.WEB_DEV_PORT || '4181'
const port = process.env.WEB_DEV_PORT || '4181'
const child = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--port', port], {
  cwd: resolve(root, 'apps/mobile'),
  stdio: 'inherit',
  env: process.env,
  shell: true,
})
child.on('exit', (code) => process.exit(code ?? 0))
