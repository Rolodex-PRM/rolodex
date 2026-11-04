import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

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

function start(args) {
  return spawn('pnpm', args, { stdio: 'inherit' })
}

const migrate = start(['--filter', '@rolodex/db', 'migrate'])
migrate.on('exit', (code, signal) => {
  if (signal || code) process.exit(code || 1)
  const children = [start(['--filter', '@rolodex/api', 'start']), start(['--filter', '@rolodex/carddav', 'start'])]
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
