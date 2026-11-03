import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnv() {
  for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (process.env[key] != null) continue
      process.env[key] = trimmed.slice(eq + 1).trim()
    }
    return
  }
}
