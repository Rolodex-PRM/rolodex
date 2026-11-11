import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

function ensureCertificate() {
  const cert = process.env.CARDDAV_TLS_CERT
  const key = process.env.CARDDAV_TLS_KEY
  if (!cert || !key || existsSync(cert)) return
  mkdirSync('/certs', { recursive: true })
  const host = process.env.PUBLIC_HOST || 'localhost'
  const names = ['DNS:localhost']
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) names.push(`IP:${host}`)
  else names.push(`DNS:${host}`)
  names.push('IP:127.0.0.1')
  const result = spawnSync('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '825',
    '-keyout', key,
    '-out', cert,
    '-subj', `/CN=${host}`,
    '-addext', `subjectAltName=${names.join(',')}`,
  ], { stdio: 'inherit' })
  if (result.status) process.exit(result.status)
}

ensureCertificate()

function startNode(script) {
  return spawn(process.execPath, [join(process.cwd(), script)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DRIZZLE_MIGRATIONS_FOLDER: process.env.DRIZZLE_MIGRATIONS_FOLDER || join(process.cwd(), 'packages/db/drizzle'),
    },
  })
}

const migrate = startNode('packages/db/dist/migrate.js')
migrate.on('exit', (code, signal) => {
  if (signal || code) process.exit(code || 1)
  const children = [
    startNode('apps/api/dist/main.js'),
    startNode('apps/carddav/dist/main.js'),
  ]
  if (process.env.DOCKER_SITE === 'true') {
    mkdirSync(process.env.DATA_DIR || '/data', { recursive: true })
    children.push(spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' }))
  }
  let stopping = false
  const stop = (status) => {
    if (stopping) return
    stopping = true
    for (const child of children) child.kill('SIGTERM')
    setTimeout(() => process.exit(status), 500)
  }
  process.on('SIGTERM', () => stop(0))
  process.on('SIGINT', () => stop(0))
  for (const child of children) {
    child.on('exit', (childCode, childSignal) => {
      if (stopping) return
      stop(childSignal ? 1 : (childCode ?? 1))
    })
  }
})
