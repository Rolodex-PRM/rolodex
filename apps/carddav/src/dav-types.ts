export type DavRequest = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
  ip?: string
}

export type DavResult = {
  status: number
  headers: Record<string, string>
  body: string
}

export function requestOrigin(headers: DavRequest['headers']) {
  const hostHeader = headers.host ?? headers.Host
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.trim()
  if (!host) return ''
  const forwardedHeader = headers['x-forwarded-proto'] ?? headers['X-Forwarded-Proto']
  const forwarded = (Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader)?.split(',')[0]?.trim()
  const proto = forwarded === 'https' ? 'https' : 'http'
  return `${proto}://${host}`
}

export function absoluteHref(origin: string, path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return origin ? `${origin}${normalized}` : normalized
}

export type DavMount = '/carddav' | '/caldav'

const mounts = ['/carddav', '/caldav', '/dav'] as const

export function mountPrefix(input: string): DavMount {
  const path = decodeURIComponent((input.split('?')[0] || '/')).replace(/\/+$/, '') || '/'
  if (path === '/caldav' || path.startsWith('/caldav/') || path === '/.well-known/caldav') return '/caldav'
  return '/carddav'
}

export function servicePath(input: string) {
  const path = decodeURIComponent((input.split('?')[0] || '/')).replace(/\/+$/, '') || '/'
  for (const prefix of mounts) {
    if (path === prefix) return '/'
    if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length) || '/'
  }
  return path
}

export function davHref(origin: string, path: string, prefix: DavMount = '/carddav') {
  const normalized = path.startsWith('/') ? path : `/${path}`
  if (normalized === '/carddav' || normalized.startsWith('/carddav/') || normalized === '/caldav' || normalized.startsWith('/caldav/')) {
    return absoluteHref(origin, normalized)
  }
  let root: DavMount = prefix
  if (normalized === '/calendars' || normalized.startsWith('/calendars/')) root = '/caldav'
  else if (normalized === '/addressbooks' || normalized.startsWith('/addressbooks/')) root = '/carddav'
  if (normalized === '/') return absoluteHref(origin, `${root}/`)
  return absoluteHref(origin, `${root}${normalized}`)
}
