import http from 'node:http'
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

const listenPort = Number(process.env.PORT || 8080)
const webPort = Number(process.env.WEB_DEV_PORT || 4181)
const apiPort = Number(process.env.API_PORT || 4100)
const davPort = Number(process.env.CARDDAV_PORT || 4101)

function upstream(url = '/') {
  const path = url.split('?')[0] || '/'
  if (path === '/api' || path.startsWith('/api/')) return apiPort
  if (path === '/carddav' || path.startsWith('/carddav/') || path === '/.well-known/carddav') return davPort
  if (path === '/caldav' || path.startsWith('/caldav/') || path === '/.well-known/caldav') return davPort
  if (
    path === '/principals' ||
    path.startsWith('/principals/') ||
    path === '/addressbooks' ||
    path.startsWith('/addressbooks/') ||
    path === '/calendars' ||
    path.startsWith('/calendars/')
  ) {
    return davPort
  }
  return webPort
}

function forwardHeaders(req) {
  const headers = { ...req.headers }
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'http'
  if (!headers['x-forwarded-host'] && headers.host) headers['x-forwarded-host'] = headers.host
  return headers
}

function proxy(req, res) {
  const request = http.request(
    { hostname: '127.0.0.1', port: upstream(req.url), path: req.url, method: req.method, headers: forwardHeaders(req) },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
      upstreamResponse.pipe(res)
    },
  )
  request.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }).end('The service behind this path is not running')
  })
  req.pipe(request)
}

const server = http.createServer(proxy)
server.on('upgrade', (req, socket, head) => {
  const request = http.request({ hostname: '127.0.0.1', port: upstream(req.url), path: req.url, method: req.method, headers: forwardHeaders(req) })
  request.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const headers = Object.entries(upstreamResponse.headers)
      .flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => `${key}: ${item}`) : [`${key}: ${value ?? ''}`]))
      .join('\r\n')
    socket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage || 'Switching Protocols'}\r\n${headers}\r\n\r\n`)
    if (upstreamHead?.length) socket.write(upstreamHead)
    if (head?.length) upstreamSocket.write(head)
    upstreamSocket.pipe(socket)
    socket.pipe(upstreamSocket)
  })
  request.on('error', () => socket.destroy())
  request.end()
})

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`Rolodex on ${listenPort}: / → ${webPort}, /api → ${apiPort}, /carddav and /caldav → ${davPort}`)
})
